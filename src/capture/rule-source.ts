import type { DiagnosticsSnapshot } from "../live/model.ts";
import { displayPace, frameCpuMs, medianOf } from "../recording/display-pace.ts";
import { parseRecording } from "../recording/format.ts";
import type { CaptureContext, CaptureRule, DiagnosticFrame } from "../recording/types.ts";
import type { CaptureSource } from "./controller.ts";
import { compileRule, ruleLimits } from "./rules.ts";

function ownFrame(frame: DiagnosticsSnapshot["frames"][number]): DiagnosticFrame {
  if (
    !("update" in frame) ||
    typeof frame.update !== "number" ||
    !("render" in frame) ||
    typeof frame.render !== "number" ||
    !("droppedScopes" in frame) ||
    typeof frame.droppedScopes !== "number"
  )
    throw new Error("Rule capture requires complete collector frame records.");
  return {
    ...frame,
    update: frame.update,
    render: frame.render,
    droppedScopes: frame.droppedScopes,
    scopes: frame.scopes.map((scope) => ({ ...scope })),
    overhead: { ...frame.overhead },
  };
}

/** The frames the display's pace is judged over: the panel's own statistics window. */
const PACE_FRAMES = 180;

/**
 * Adds frame-driven rules around a legacy recorder; no rendering, timers or host loop.
 * `readGpuMs` gives the latest complete GPU span, so sustained and episode rules can follow the
 * display's pace; without one they use the budget, because no pace can be claimed.
 */
export function createRuleCaptureSource(
  source: CaptureSource,
  readGpuMs?: () => number | null,
): CaptureSource {
  if (!source.armCapture)
    throw new Error("Rule capture requires a collector with automatic sampling support.");
  const initial = parseRecording(JSON.stringify(source.export()));
  const limits = ruleLimits(initial.frameCapacity, true);
  let enabled = false;
  let rule: CaptureRule | null = null;
  let state: "idle" | "armed" | "recording" | "cooldown" = "idle";
  let stage: "episode" | "after" = "after";
  let history: DiagnosticFrame[] = [];
  let frames: DiagnosticFrame[] = [];
  let lastId = -1;
  let lastAt = 0;
  let onset: DiagnosticFrame | null = null;
  let streak = 0;
  let crossings = 0;
  let trigger: DiagnosticFrame | null = null;
  let remaining = 0;
  let lastSlowAt = 0;
  let ended: DiagnosticFrame | null = null;
  let reason: CaptureContext["reason"] = "window";
  let context: CaptureContext | undefined;
  let cooldownUntil = 0;
  let recent: { intervalMs: number; cpuMs: number }[] = [];
  let slowMs = 0;
  const remember = (frame: DiagnosticFrame) => {
    recent.push({ intervalMs: frame.interval, cpuMs: frameCpuMs(frame) });
    if (recent.length > PACE_FRAMES) recent.shift();
  };
  const slowLimit = (budgetMs: number) => {
    const gpuMs = readGpuMs?.() ?? null;
    if (gpuMs === null) return budgetMs;
    const pace = displayPace(
      budgetMs,
      medianOf(recent.map((frame) => frame.intervalMs)),
      Math.max(medianOf(recent.map((frame) => frame.cpuMs)), gpuMs),
    );
    return pace?.limitMs ?? budgetMs;
  };
  const finish = (frame: DiagnosticFrame, why: CaptureContext["reason"]) => {
    if (!rule || !trigger || !onset) throw new Error("Missing automatic capture context.");
    source.stopRecording();
    ended ??= rule.keep === "fixed" ? trigger : frame;
    const triggerId = trigger.id;
    const endId = ended.id;
    context = {
      rule: { ...rule },
      onsetFrame: onset.id,
      onsetAt: onset.at - onset.interval,
      triggerAt: trigger.at,
      endFrame: ended.id,
      endAt: ended.at,
      reason: why,
      crossings,
      beforeFrames: frames.filter((f) => f.id < triggerId).length,
      afterFrames: frames.filter((f) => f.id > endId).length,
    };
    remaining = 0;
    cooldownUntil = frame.at + rule.cooldownMs;
    state = enabled ? "cooldown" : "idle";
    if (enabled) source.armCapture?.({ ...rule, thresholdMs: Number.MAX_VALUE });
  };
  const decorate = (snapshot: DiagnosticsSnapshot) =>
    rule && (enabled || frames.length > 0)
      ? {
          ...snapshot,
          recording: state === "recording",
          recordedFrames: frames.length,
          capture: {
            ...snapshot.capture,
            mode: "automatic" as const,
            state,
            triggerFrame: trigger?.id ?? null,
            remainingFrames: remaining,
            stage,
            episodeMs: onset ? Math.max(0, lastAt - (onset.at - onset.interval)) : 0,
          },
        }
      : snapshot;
  const wrapped: CaptureSource = {
    ...source,
    captureRules: limits,
    recordingFrameIds: () =>
      rule && (enabled || frames.length > 0)
        ? frames.map((frame) => frame.id)
        : (source.recordingFrameIds?.() ?? null),
    snapshot: (includeSystems) => {
      const snapshot = source.snapshot(includeSystems);
      if (snapshot.recording && state !== "recording") return snapshot;
      return {
        ...decorate(snapshot),
        recordedFrames:
          rule && (enabled || frames.length > 0) ? frames.length : snapshot.recordedFrames,
      };
    },
    armCapture(next) {
      const compiled = compileRule(next, next.budgetMs, limits);
      const snapshot = source.snapshot(false);
      if (snapshot.recording) throw new Error("Stop the current recording before re-arming.");
      const seed = compiled.beforeFrames
        ? snapshot.frames.slice(-compiled.beforeFrames).map(ownFrame)
        : [];
      // Keep detailed sampling enabled; detection belongs to this adapter.
      source.armCapture?.({ ...compiled, thresholdMs: Number.MAX_VALUE });
      rule = compiled;
      enabled = true;
      state = "armed";
      history = seed;
      frames = [];
      trigger = onset = ended = null;
      context = undefined;
      streak = crossings = remaining = cooldownUntil = 0;
      recent = [];
      snapshot.frames.slice(-PACE_FRAMES).map(ownFrame).forEach(remember);
      slowMs = compiled.budgetMs;
      lastId = snapshot.frames.at(-1)?.id ?? -1;
      lastAt = snapshot.frames.at(-1)?.at ?? 0;
    },
    disarmCapture() {
      source.disarmCapture();
      enabled = false;
      if (state !== "recording") state = "idle";
    },
    startRecording() {
      if (state !== "recording" && source.snapshot(false).recording)
        throw new Error("A recording is already active outside this panel.");
      source.startRecording();
      rule = null;
      enabled = false;
      state = "idle";
      frames = history = [];
      context = undefined;
    },
    stopRecording() {
      const last = frames.at(-1);
      if (state === "recording" && last) finish(last, "stopped");
      else source.stopRecording();
    },
    observeCapture(snapshot) {
      if (!rule || !enabled) return decorate(snapshot);
      if (snapshot.recording && snapshot.capture.mode === "manual" && state !== "recording")
        throw new Error("A recording is already active outside this panel.");
      const latest = snapshot.frames.at(-1);
      if (latest && (latest.id < lastId || latest.at < lastAt))
        throw new Error("Collector restarted; turn Auto off and re-arm.");
      const fresh = snapshot.frames.filter((frame) => frame.id > lastId);
      if (fresh.length > 1)
        throw new Error(
          "Observe rule capture after every sealed frame, before collecting the next one.",
        );
      const raw = fresh[0];
      if (!raw) return decorate(snapshot);
      const frame = ownFrame(raw);
      lastId = frame.id;
      lastAt = frame.at;
      history.push(frame);
      if (history.length > rule.beforeFrames + 1) history.shift();
      remember(frame);
      if (state === "cooldown") {
        if (frame.at < cooldownUntil) return decorate(snapshot);
        state = "armed";
        onset = null;
        streak = crossings = 0;
      }
      if (state === "armed") {
        // Held for the whole slow run, or a long slowdown would become its own excuse in the median.
        if (!onset)
          slowMs = frame.interval > rule.budgetMs ? slowLimit(rule.budgetMs) : rule.budgetMs;
        const slow = frame.interval > (rule.mode === "spike" ? rule.thresholdMs : slowMs);
        if (!slow) {
          onset = null;
          streak = crossings = 0;
          return decorate(snapshot);
        }
        onset ??= frame;
        streak += frame.interval;
        crossings++;
        if (rule.mode !== "spike" && streak + 1e-9 < rule.sustainedMs) return decorate(snapshot);
        source.startRecording();
        if (!source.snapshot(false).recording)
          throw new Error("Collector did not start the automatic window.");
        frames = [...history];
        trigger = frame;
        ended = null;
        context = undefined;
        state = "recording";
        stage = rule.keep === "episode" ? "episode" : "after";
        remaining = rule.afterFrames;
        lastSlowAt = frame.at;
        if (stage === "after" && !remaining) finish(frame, "window");
        else if (stage === "episode" && frame.at - (onset.at - onset.interval) >= rule.limitMs)
          finish(frame, "limit");
      } else if (state === "recording") {
        frames.push(frame);
        if (stage === "episode") {
          if (frame.interval > slowMs) {
            lastSlowAt = frame.at;
            crossings++;
          }
          if (onset && frame.at - (onset.at - onset.interval) >= rule.limitMs) {
            finish(frame, "limit");
            return decorate(snapshot);
          }
          if (frame.at - lastSlowAt + 1e-9 >= rule.quietMs) {
            ended = frame;
            reason = "recovered";
            stage = "after";
            remaining = rule.afterFrames;
            if (!remaining) finish(frame, reason);
          }
        } else {
          remaining--;
          if (remaining <= 0) finish(frame, rule.keep === "episode" ? reason : "window");
        }
      }
      if (
        state === "recording" &&
        rule.keep === "episode" &&
        onset &&
        frame.at - (onset.at - onset.interval) >= rule.limitMs
      )
        finish(frame, "limit");
      if (state === "recording" && frames.length >= limits.capacity) finish(frame, "capacity");
      return decorate(snapshot);
    },
    export() {
      const exported = parseRecording(JSON.stringify(source.export()));
      if (!rule || !frames.length) return exported;
      const first = frames[0];
      const last = frames.at(-1);
      if (!first || !last) return exported;
      const recent = frames.slice(-600);
      const cost = (key: "collectionMs" | "refreshMs") => ({
        last: last.overhead[key],
        mean: recent.reduce((sum, frame) => sum + frame.overhead[key], 0) / recent.length,
        peak: recent.reduce((peak, frame) => Math.max(peak, frame.overhead[key]), 0),
      });
      // shortcut: legacy exports lack pre-trigger counters; add host counter history. GPU history uses finalizeGpu.
      return {
        ...exported,
        budget: { frameMs: rule.budgetMs, targetFps: 1000 / rule.budgetMs },
        overhead: {
          ...exported.overhead,
          frames: recent.length,
          collection: cost("collectionMs"),
          refresh: cost("refreshMs"),
        },
        frames: structuredClone(frames),
        events: exported.events.filter(
          (event) => event.at >= first.at - first.interval && event.at <= last.at,
        ),
        samples: exported.samples.filter(
          (sample) => sample.at >= first.at - first.interval && sample.at <= last.at,
        ),
        capture: {
          mode: "automatic",
          state,
          triggerFrame: trigger?.id ?? null,
          thresholdMs: rule.mode === "spike" ? rule.thresholdMs : rule.budgetMs,
          beforeFrames: rule.beforeFrames,
          afterFrames: rule.afterFrames,
          cooldownMs: rule.cooldownMs,
          remainingFrames: remaining,
          ...(context ? { context: structuredClone(context) } : {}),
        },
      };
    },
  };
  return wrapped;
}
