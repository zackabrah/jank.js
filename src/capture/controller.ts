import type { GpuCoverage } from "../gpu/model.ts";
import type { DiagnosticsSnapshot } from "../live/model.ts";
import { parseRecording } from "../recording/format.ts";
import type { CaptureRule, PerformanceRecording, RuleSettings } from "../recording/types.ts";
import { type GpuPool, readBuffers } from "./buffers.ts";
import { compileRule, type RuleLimits, ruleLimits } from "./rules.ts";

export interface CaptureSource {
  snapshot(includeSystems?: boolean): DiagnosticsSnapshot & { recordedFrames: number };
  startRecording(): void;
  stopRecording(): void;
  armCapture?(rule: CaptureRule): void;
  captureRules?: RuleLimits;
  observeCapture?(snapshot: DiagnosticsSnapshot): DiagnosticsSnapshot;
  disarmCapture(): void;
  export(): unknown;
  recentFrameCapacity?: number;
  recordingFrameIds?(): readonly number[] | null;
  gpuCoverage?(frameIds: readonly number[]): GpuCoverage;
  gpuPool?(): GpuPool | null;
  finalizeGpu?(
    recording: PerformanceRecording,
    signal: AbortSignal,
  ): Promise<NonNullable<PerformanceRecording["gpuTiming"]>>;
}

export interface SavedCapture {
  id: number;
  savedAt: number;
  recording: PerformanceRecording;
}

export interface CaptureConnection {
  controller: CaptureController;
  onOpen: (capture: SavedCapture) => void | Promise<void>;
}

export const comparisonCaptureReason =
  "Stop the comparison before recording or arming automatic capture.";
const externalRecordingReason = "A recording is running outside this panel.";

export interface AutomaticCapture {
  state: "off" | "armed" | "capturing" | "cooldown";
  rule: CaptureRule;
  limits: RuleLimits;
  stage: "episode" | "after";
  episodeMs: number;
  remainingFrames: number;
  cooldownRemainingMs: number;
  window: { first: number; trigger: number; last: number } | null;
}

export interface CaptureState {
  phase: "idle" | "recording" | "finalizing" | "unsaved";
  kind: "manual" | "automatic";
  automatic: AutomaticCapture | null;
  frames: number;
  capacity: number;
  elapsedMs: number;
  afterFrameId: number | null;
  saved: readonly SavedCapture[];
  error: string;
  blocked: string;
  message: string;
}

/** Host-owned; observe every sealed frame, independently of throttled rendering. */
export function createCaptureController(source: CaptureSource) {
  const initial = parseRecording(JSON.stringify(source.export()));
  const capacity = initial.frameCapacity;
  const beforeFrames = Math.min(120, initial.capture.beforeFrames, capacity - 1);
  const afterFrames = Math.min(60, initial.capture.afterFrames, capacity - beforeFrames - 1);
  const limits = source.captureRules ?? ruleLimits(capacity, false);
  let settings: RuleSettings = {
    mode: "spike",
    keep: "fixed",
    thresholdMs: initial.budget.frameMs * 2,
    sustainedMs: 250,
    quietMs: 100,
    limitMs: 30000,
    beforeSeconds: (beforeFrames * initial.budget.frameMs) / 1000,
    afterSeconds: (afterFrames * initial.budget.frameMs) / 1000,
    cooldownMs: initial.capture.cooldownMs,
  };
  let editedRule = false;
  let state: CaptureState = {
    phase: "idle",
    kind: "manual",
    automatic: source.armCapture
      ? {
          state: "off",
          rule: compileRule(settings, initial.budget.frameMs, limits),
          limits,
          stage: "after",
          episodeMs: 0,
          remainingFrames: 0,
          cooldownRemainingMs: 0,
          window: null,
        }
      : null,
    frames: 0,
    capacity,
    elapsedMs: 0,
    afterFrameId: null,
    saved: [],
    error: "",
    blocked: "",
    message: "",
  };
  const listeners = new Set<() => void>();
  let notify = true;
  let startedAt = 0;
  let nextId = 1;
  let lastTrigger: number | null = null;
  let cooldownUntil = 0;
  let finalization: AbortController | null = null;
  let pendingRecording: PerformanceRecording | null = null;
  let resumeAuto = false;
  let observed: DiagnosticsSnapshot = source.snapshot();
  let comparisonOwner: object | null = null;
  let buffers = readBuffers(source, observed, null);
  const refreshBuffers = () => {
    buffers = readBuffers(
      source,
      observed,
      state.phase === "idle" ? null : state.frames,
      pendingRecording?.frames.map((frame) => frame.id),
    );
  };
  const publish = (patch: Partial<CaptureState>) => {
    state = { ...state, ...patch };
    if (notify) {
      refreshBuffers();
      for (const listener of listeners) listener();
    }
  };
  const attempt = (work: () => void) => {
    try {
      work();
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : "Capture failed. Try again." });
    }
  };
  const progress = (snapshot: DiagnosticsSnapshot) => {
    const count = snapshot.recordedFrames;
    if (count === undefined || !Number.isSafeInteger(count) || count < 0 || count > capacity)
      throw new Error("Collector supplied an invalid recorded-frame count.");
    return {
      frames: count,
      elapsedMs: count ? Math.max(0, (snapshot.frames.at(-1)?.at ?? startedAt) - startedAt) : 0,
    };
  };
  const save = () => {
    const snapshot = source.snapshot();
    observed = snapshot;
    if (snapshot.recording) throw new Error("Stop recording before saving.");
    const current = progress(snapshot);
    if (!current.frames) {
      publish({
        ...current,
        phase: "idle",
        error: "",
        message: "No completed frames; nothing saved.",
      });
      return;
    }
    // A failed export keeps the stopped buffer available and blocks replacement.
    publish({ ...current, phase: "unsaved" });
    const recording = pendingRecording ?? parseRecording(JSON.stringify(source.export()));
    if (recording.capture.mode !== state.kind || recording.frames.length !== current.frames)
      throw new Error("The collector recording changed before it could be saved.");
    if (!source.finalizeGpu) {
      commitRecording(recording);
      return;
    }
    pendingRecording = recording;
    if (state.automatic && state.automatic.state !== "off") {
      source.disarmCapture();
      resumeAuto = true;
    }
    const abort = new AbortController();
    finalization = abort;
    publish({ phase: "finalizing", error: "", message: "Finalizing GPU results…" });
    // A broken host finalizer must not leave the capture permanently locked.
    const timeout = setTimeout(() => {
      if (finalization !== abort) return;
      abort.abort();
      finalization = null;
      attempt(autoOff);
      publish({ phase: "unsaved", error: "GPU finalization did not finish; retry or discard." });
    }, 1000);
    void Promise.resolve()
      .then(() => source.finalizeGpu?.(structuredClone(recording), abort.signal))
      .then((gpuTiming) => {
        if (abort.signal.aborted || finalization !== abort) return;
        if (!gpuTiming) throw new Error("The host returned no GPU finalization result.");
        const finished = parseRecording(JSON.stringify({ ...recording, gpuTiming }));
        commitRecording(finished);
        if (resumeAuto && state.automatic)
          publish({ automatic: { ...state.automatic, state: "cooldown", remainingFrames: 0 } });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || finalization !== abort) return;
        finalization = null;
        attempt(autoOff);
        publish({
          phase: "unsaved",
          error:
            error instanceof Error ? error.message : "GPU finalization failed; retry or discard.",
        });
      })
      .finally(() => clearTimeout(timeout));
  };
  const commitRecording = (recording: PerformanceRecording) => {
    if (state.kind === "automatic") {
      const first = recording.frames[0];
      const last = recording.frames.at(-1);
      const trigger = recording.capture.triggerFrame;
      if (!first || !last || trigger === null || !recording.frames.some((f) => f.id === trigger))
        throw new Error("The automatic recording is missing its trigger frame.");
      lastTrigger = trigger;
      cooldownUntil = last.at + recording.capture.cooldownMs;
      if (state.automatic)
        publish({
          automatic: { ...state.automatic, window: { first: first.id, trigger, last: last.id } },
        });
    }
    pendingRecording = null;
    finalization = null;
    const capture = { id: nextId++, savedAt: Date.now(), recording };
    publish({
      phase: "idle",
      saved: [capture, ...state.saved].slice(0, 10),
      error: "",
      blocked: "",
      message: `Capture C${capture.id} saved.`,
    });
  };
  const autoOff = () => {
    resumeAuto = false;
    source.disarmCapture();
    if (state.automatic)
      publish({
        automatic: { ...state.automatic, state: "off", window: null, cooldownRemainingMs: 0 },
      });
  };
  const arm = (rule: CaptureRule) => {
    if (!source.armCapture) throw new Error("This host does not support automatic capture.");
    source.armCapture(rule);
    const armed = source.snapshot();
    if (
      armed.recording ||
      armed.capture.state !== "armed" ||
      armed.capture.triggerFrame !== null ||
      armed.capture.remainingFrames !== 0
    ) {
      source.disarmCapture();
      throw new Error("The collector did not arm automatic capture with valid progress.");
    }
    lastTrigger = null;
    cooldownUntil = 0;
  };
  const controller = {
    comparisonUnavailable() {
      let snapshot: DiagnosticsSnapshot;
      try {
        snapshot = source.snapshot();
      } catch (error) {
        return error instanceof Error ? error.message : "Could not read capture state.";
      }
      // Name the thing to stop and where it lives, so the reason is never a dead end.
      if (comparisonOwner) return "A comparison is already running.";
      if (state.phase === "recording" && state.kind === "manual")
        return "Stop and save the recording before comparing.";
      if (state.phase === "finalizing" || state.phase === "unsaved")
        return "Save or discard the stopped recording before comparing.";
      if (state.automatic && state.automatic.state !== "off")
        return "Turn off automatic capture before comparing.";
      if (snapshot.recording) return `${externalRecordingReason} Stop it in the host to compare.`;
      if (snapshot.capture.state !== "idle")
        return "Automatic capture is active outside this panel. Disarm it in the host to compare.";
      return "";
    },
    /** Exclusive trial recorder; the comparison owns cleanup, never the panel. */
    reserveComparison() {
      const reason = controller.comparisonUnavailable();
      if (reason) throw new Error(reason);
      const owner = {};
      comparisonOwner = owner;
      try {
        publish({ blocked: "", message: "", error: "" });
      } catch (error) {
        comparisonOwner = null;
        throw error;
      }
      return {
        source,
        release() {
          if (comparisonOwner !== owner) return;
          comparisonOwner = null;
          observed = source.snapshot();
          publish({ blocked: "" });
        },
      };
    },
    recordingUnavailable() {
      if (comparisonOwner) return comparisonCaptureReason;
      // A host-owned recording is not ours to stop; say so where Rec lives instead of after a press.
      if (state.phase === "idle" && observed.recording && observed.capture.mode !== "automatic")
        return externalRecordingReason;
      return "";
    },
    getSnapshot: () => state,
    getBuffers: () => buffers,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Call after every sealed frame; false defers subscriber updates to the next UI refresh. */
    refresh(snapshot: DiagnosticsSnapshot, render = true) {
      notify = false;
      observed = snapshot;
      try {
        attempt(() => {
          if (comparisonOwner) return;
          if (state.phase === "finalizing") return;
          if (resumeAuto && state.phase === "idle" && state.automatic) {
            const remaining = Math.max(0, cooldownUntil - (snapshot.frames.at(-1)?.at ?? 0));
            publish({
              automatic: { ...state.automatic, state: "cooldown", cooldownRemainingMs: remaining },
            });
            if (remaining > 0) return;
            arm(state.automatic.rule);
            resumeAuto = false;
            snapshot = source.snapshot(false);
          }
          snapshot = source.observeCapture?.(snapshot) ?? snapshot;
          observed = snapshot;
          const automatic = state.automatic;
          if (automatic && automatic.state !== "off" && state.phase !== "unsaved") {
            const trigger = snapshot.capture.triggerFrame;
            const remaining = snapshot.capture.remainingFrames;
            if (
              snapshot.capture.mode === "automatic" &&
              trigger !== null &&
              trigger !== undefined &&
              trigger !== lastTrigger
            ) {
              if (
                !Number.isSafeInteger(trigger) ||
                trigger < 0 ||
                remaining === undefined ||
                !Number.isSafeInteger(remaining) ||
                remaining < 0 ||
                remaining > automatic.rule.afterFrames
              )
                throw new Error("Collector supplied invalid automatic capture progress.");
              const frames = snapshot.frames.filter(
                (f) => f.id >= trigger - automatic.rule.beforeFrames,
              );
              if (automatic.window?.trigger !== trigger)
                startedAt = (frames[0]?.at ?? 0) - (frames[0]?.interval ?? 0);
              const current = progress(snapshot);
              publish({ kind: "automatic", phase: "recording", ...current });
              publish({
                automatic: {
                  ...automatic,
                  state: "capturing",
                  remainingFrames: remaining,
                  stage: snapshot.capture.stage ?? "after",
                  episodeMs: snapshot.capture.episodeMs ?? 0,
                  window: {
                    first: frames[0]?.id ?? trigger,
                    trigger,
                    last: snapshot.frames.at(-1)?.id ?? trigger,
                  },
                },
              });
              if (!snapshot.recording) {
                try {
                  save();
                } catch (error) {
                  // Prevent the next trigger overwriting a recording that still needs saving.
                  autoOff();
                  throw error;
                }
              }
            }
            if (state.phase === "idle" && state.automatic) {
              const remainingMs = Math.max(0, cooldownUntil - (snapshot.frames.at(-1)?.at ?? 0));
              publish({
                automatic: {
                  ...state.automatic,
                  state:
                    snapshot.capture.state === "cooldown" && remainingMs > 0 ? "cooldown" : "armed",
                  cooldownRemainingMs: remainingMs,
                  remainingFrames: 0,
                },
              });
            }
          } else if (state.phase === "recording" && state.kind === "manual") {
            const current = progress(snapshot);
            if (!snapshot.recording) save();
            else if (current.frames !== state.frames || current.elapsedMs !== state.elapsedMs)
              publish(current);
          }
        });
      } finally {
        notify = true;
      }
      if (render) {
        refreshBuffers();
        for (const listener of listeners) listener();
      }
    },
    autoUnavailable() {
      if (comparisonOwner) return comparisonCaptureReason;
      if (!state.automatic) return "This host does not support automatic capture.";
      if (state.phase === "finalizing") return "Wait for GPU finalization or discard the capture.";
      if (state.phase === "unsaved")
        return "Save or discard the stopped recording before arming automatic capture.";
      if (state.phase === "recording" && state.kind === "manual")
        return "Stop manual recording before arming automatic capture.";
      if (observed.recording && observed.capture.mode !== "automatic")
        return externalRecordingReason;
      return "";
    },
    getRuleSettings() {
      return { ...settings, ...(!editedRule ? { thresholdMs: observed.budget.frameMs * 2 } : {}) };
    },
    applyRule(next: RuleSettings) {
      if (state.phase === "finalizing")
        throw new Error("Wait for GPU finalization or discard the capture.");
      const automatic = state.automatic;
      if (!automatic) throw new Error("This host does not support automatic capture.");
      if (state.phase === "unsaved")
        throw new Error("Save or discard the stopped recording before applying a rule.");
      if (state.phase === "recording" && state.kind === "automatic")
        throw new Error("Wait for the current automatic capture to finish before applying a rule.");
      observed = source.snapshot();
      const compiled = compileRule(next, observed.budget.frameMs, limits);
      if (automatic.state !== "off") {
        try {
          arm(compiled);
        } catch (error) {
          try {
            arm(automatic.rule);
          } catch {
            autoOff();
          }
          throw error;
        }
      }
      settings = { ...next };
      editedRule = true;
      publish({
        automatic: {
          ...automatic,
          rule: compiled,
          state: automatic.state === "off" ? "off" : "armed",
          window: null,
          remainingFrames: 0,
          episodeMs: 0,
          stage: "after",
          cooldownRemainingMs: 0,
        },
        error: "",
        blocked: "",
      });
    },
    toggleAuto() {
      attempt(() => {
        observed = source.snapshot();
        const reason = controller.autoUnavailable();
        if (reason) {
          publish({ blocked: reason });
          return;
        }
        const automatic = state.automatic;
        if (!automatic || !source.armCapture) return;
        if (automatic.state !== "off") {
          autoOff();
          if (state.phase === "recording" && state.kind === "automatic") source.stopRecording();
          publish({ phase: "idle", blocked: "", error: "", message: "Automatic capture off." });
          return;
        }
        const rule = compileRule(controller.getRuleSettings(), observed.budget.frameMs, limits);
        arm(rule);
        publish({
          kind: "automatic",
          automatic: {
            ...automatic,
            state: "armed",
            rule,
            window: null,
            cooldownRemainingMs: 0,
            remainingFrames: 0,
            episodeMs: 0,
            stage: "after",
          },
          blocked: "",
          error: "",
          message: "",
        });
      });
    },
    dismissBlocked() {
      publish({ blocked: "" });
    },
    start() {
      attempt(() => {
        if (comparisonOwner) {
          publish({ blocked: comparisonCaptureReason });
          return;
        }
        if (state.phase === "finalizing")
          throw new Error("Wait for GPU finalization or discard the capture.");
        if (state.phase === "unsaved" || (state.phase === "recording" && state.kind === "manual"))
          throw new Error("Save or discard the current recording first.");
        const snapshot = source.snapshot();
        if (snapshot.recording && snapshot.capture.mode !== "automatic") {
          // A blocked press, not a failure: the host's recording keeps running untouched.
          publish({ blocked: externalRecordingReason });
          return;
        }
        autoOff();
        pendingRecording = null;
        source.startRecording();
        const started = source.snapshot();
        observed = started;
        if (!started.recording || started.recordedFrames !== 0)
          throw new Error("The collector did not start a fresh recording.");
        startedAt = snapshot.frames.at(-1)?.at ?? 0;
        publish({
          phase: "recording",
          kind: "manual",
          frames: 0,
          elapsedMs: 0,
          afterFrameId: snapshot.frames.at(-1)?.id ?? null,
          error: "",
          blocked: "",
          message: "",
        });
      });
    },
    stopAndSave() {
      if (state.phase === "idle" || state.phase === "finalizing") return;
      attempt(() => {
        if (state.phase === "recording") source.stopRecording();
        publish({ phase: "unsaved" });
        save();
      });
    },
    discard() {
      if (state.phase === "idle") return;
      attempt(() => {
        finalization?.abort();
        finalization = null;
        pendingRecording = null;
        if (resumeAuto) autoOff();
        if (state.phase === "recording") source.stopRecording();
        // clear() would also erase live history; the next start replaces the recording buffer.
        observed = source.snapshot();
        publish({
          phase: "idle",
          frames: 0,
          elapsedMs: 0,
          error: "",
          blocked: "",
          message: "Recording discarded.",
        });
      });
    },
  };
  return controller;
}

type CaptureController = ReturnType<typeof createCaptureController>;
