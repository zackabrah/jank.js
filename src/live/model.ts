/*! Statistics adapted from jank.js (MIT), Copyright 2026 Isaac Johnson; see public/licenses/jank.js.txt. */
import { type GpuFrame, gpuFrameCoverage, validateGpuFrame } from "../gpu/model.ts";
import { type LoadingSnapshot, readLoading } from "../loading/model.ts";
import type { Measurement } from "../measurement.ts";
import { displayPace, medianOf } from "../recording/display-pace.ts";
import type { DiagnosticEvent } from "../recording/types.ts";
import { formatCounter } from "./counters.ts";
import { readEvents } from "./events.ts";

/** Structural subset of jank.js DiagnosticSnapshot; no collector or UI dependency. */
export interface DiagnosticsSnapshot {
  /** Optional event history, on the same relative millisecond clock as frames. */
  events?: readonly DiagnosticEvent[];
  frames: readonly {
    id: number;
    at: number;
    interval: number;
    coverage: "complete" | "truncated" | "unavailable";
    scopes: readonly { system: string; label: string; start: number; end: number }[];
    overhead: { collectionMs: number; refreshMs: number };
  }[];
  systems: readonly {
    id: string;
    label: string;
    values: Readonly<Record<string, number | string | boolean | null>>;
  }[];
  budget: { frameMs: number };
  recording: boolean;
  recordedFrames?: number;
  capture: {
    mode: "manual" | "automatic" | "recent";
    state: "idle" | "armed" | "recording" | "cooldown";
    triggerFrame?: number | null;
    remainingFrames?: number;
    stage?: "episode" | "after";
    episodeMs?: number;
  };
}

export interface LiveGpu {
  evidence?: GpuFrame;
  status: "ready" | "pending" | "unsupported" | "disabled" | "error";
  completeness: "complete" | "partial" | "unknown";
  expected: number | null;
  timed: number | null;
  sampleFrame: number | null;
  ageFrames: number | null;
  dropped: number;
  /** Legacy GPU busy field; never interpreted as a pass sum. */
  busy: Measurement;
  timedWork?: Measurement;
  span: Measurement;
  passes: readonly {
    id: string;
    label: string;
    kind: "render" | "compute" | "unknown";
    duration: Measurement;
  }[];
}

export interface LiveSnapshot {
  diagnostics: DiagnosticsSnapshot;
  gpu: LiveGpu | null;
  loading?: LoadingSnapshot | null;
}

/** The GPU span, only when the reading covers all of the frame's GPU work. */
export const completeGpuSpan = (gpu: LiveGpu | null) =>
  gpu?.status === "ready" && gpu.completeness === "complete" && gpu.span.status === "measured"
    ? gpu.span.value
    : null;

export const measured = (value: number): Measurement => ({ status: "measured", value });
export const unknown = (reason: string): Measurement => ({ status: "unknown", reason });
const valid = (value: number) => Number.isFinite(value) && value >= 0;

function checkMeasurement(value: Measurement) {
  if (value.status === "measured" && !valid(value.value)) throw new RangeError("Invalid timing");
}

export function judgeBudget(
  frames: DiagnosticsSnapshot["frames"],
  budget: number,
  tolerance: number,
  workMs: number | null = null,
) {
  const pace = frames.length
    ? displayPace(budget, medianOf(frames.map((frame) => frame.interval)), workMs)
    : null;
  const overLimit = pace?.limitMs ?? budget + tolerance;
  const overCount = frames.filter((frame) => frame.interval > overLimit).length;
  return {
    budget,
    overLimit,
    displayPacedMs: pace?.typicalMs ?? null,
    overCount,
    over: frames.length
      ? measured((overCount / frames.length) * 100)
      : unknown("Waiting for completed frame samples"),
  };
}

export function validateSelectedBudget(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 1000) {
    throw new RangeError("Enter a frame budget between 1 and 1000 ms.");
  }
}

/** Inclusive scope time counts overlaps once, clipped to the sealed frame. */
function union(scopes: DiagnosticsSnapshot["frames"][number]["scopes"], from: number, to: number) {
  let end = from;
  let duration = 0;
  for (const scope of scopes.toSorted((a, b) => a.start - b.start)) {
    const next = Math.min(to, scope.end);
    duration += Math.max(0, next - Math.max(end, from, scope.start));
    end = Math.max(end, next);
  }
  return duration;
}

export function readLive({ diagnostics, gpu, loading }: LiveSnapshot) {
  const budget = diagnostics.budget.frameMs;
  if (!valid(budget) || budget === 0) throw new RangeError("Frame budget must be positive");
  let previousAt = -1;
  let previousId = -1;
  for (const frame of diagnostics.frames) {
    if (
      !Number.isSafeInteger(frame.id) ||
      frame.id <= previousId ||
      !valid(frame.at) ||
      frame.at < previousAt ||
      !valid(frame.interval) ||
      !valid(frame.overhead.collectionMs) ||
      !valid(frame.overhead.refreshMs) ||
      frame.scopes.some(
        (scope) => !valid(scope.start) || !valid(scope.end) || scope.end < scope.start,
      )
    ) {
      throw new RangeError(
        "Live frames need ordered IDs/timestamps and finite non-negative timings",
      );
    }
    previousAt = frame.at;
    previousId = frame.id;
  }
  if (gpu) {
    if (gpu.evidence) {
      const coverage = gpuFrameCoverage(validateGpuFrame(gpu.evidence));
      if (
        gpu.expected !== coverage.expected ||
        gpu.timed !== coverage.timed ||
        gpu.completeness !== coverage.completeness ||
        gpu.sampleFrame !== gpu.evidence.frameId
      )
        throw new RangeError("GPU summary must match its invocation evidence");
    }
    for (const count of [gpu.expected, gpu.timed, gpu.sampleFrame, gpu.ageFrames, gpu.dropped]) {
      if (count !== null && (!Number.isSafeInteger(count) || count < 0))
        throw new RangeError("Invalid GPU count");
    }
    if (
      gpu.expected !== null &&
      gpu.timed !== null &&
      (gpu.timed > gpu.expected || (gpu.completeness === "complete" && gpu.expected !== gpu.timed))
    )
      throw new RangeError("Inconsistent GPU completeness");
    checkMeasurement(gpu.busy);
    if (gpu.timedWork) checkMeasurement(gpu.timedWork);
    checkMeasurement(gpu.span);
    for (const pass of gpu.passes) checkMeasurement(pass.duration);
    if (new Set(gpu.passes.map((pass) => pass.id)).size !== gpu.passes.length)
      throw new RangeError("Duplicate GPU pass ID");
  }
  const frames = diagnostics.frames.slice(-180);
  const latest = frames.at(-1);
  const durations = frames.map((frame) => frame.interval).sort((a, b) => a - b);
  // Match jank.js: ignore floating-point noise and allow two observed clock ticks.
  let tick = Infinity;
  for (let i = 1; i < durations.length; i++) {
    const step = (durations[i] ?? 0) - (durations[i - 1] ?? 0);
    if (step >= 0.001) tick = Math.min(tick, step);
  }
  const tolerance = Number.isFinite(tick) ? 2 * Math.min(1, tick) : 0;
  let average = 0;
  let worst = frames[0];
  frames.forEach((frame, index) => {
    average += (frame.interval - average) / (index + 1);
    if (!worst || frame.interval > worst.interval) worst = frame;
  });
  const first = diagnostics.frames[0];
  const fps =
    latest && first && latest.at - (first.at - first.interval) >= 1000
      ? measured(diagnostics.frames.filter((frame) => frame.at > latest.at - 1000).length)
      : unknown("FPS counts frame endings over one full second; still warming up");
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  const complete = frames.filter((frame) => frame.coverage === "complete");
  const cpu = new Map<string, { id: string; label: string; duration: Measurement }>(
    diagnostics.systems.map((system) => [
      system.id,
      {
        id: system.id,
        label: system.label,
        duration: complete.length
          ? {
              status: "not-observed",
              reason: "No scope observed in complete frames in this window",
            }
          : unknown("No complete scope frames in this window"),
      },
    ]),
  );
  const totals = new Map<string, number>();
  let remainder = 0;
  for (const frame of complete) {
    const groups = new Map<string, (typeof frame.scopes)[number][]>();
    for (const scope of frame.scopes) {
      const group = groups.get(scope.system) ?? [];
      group.push(scope);
      groups.set(scope.system, group);
    }
    for (const [id, group] of groups) {
      totals.set(
        id,
        (totals.get(id) ?? 0) + union(group, frame.at - frame.interval, frame.at) / complete.length,
      );
      if (!cpu.has(id))
        cpu.set(id, { id, label: group[0]?.label ?? id, duration: unknown("Waiting for scopes") });
    }
    remainder +=
      Math.max(0, frame.interval - union(frame.scopes, frame.at - frame.interval, frame.at)) /
      complete.length;
  }
  for (const [id, duration] of totals) {
    const row = cpu.get(id);
    if (row) row.duration = measured(duration);
  }
  // shortcut: the panel holds one recent GPU frame, not a median; fine away from the threshold.
  const gpuSpanMs = completeGpuSpan(gpu ?? null);
  const workMs =
    complete.length && gpuSpanMs !== null
      ? Math.max(
          medianOf(
            complete.map((frame) => union(frame.scopes, frame.at - frame.interval, frame.at)),
          ),
          gpuSpanMs,
        )
      : null;
  let collection = 0;
  let refresh = 0;
  let peak = 0;
  frames.forEach((frame, index) => {
    collection += (frame.overhead.collectionMs - collection) / (index + 1);
    refresh += (frame.overhead.refreshMs - refresh) / (index + 1);
    peak = Math.max(peak, frame.overhead.collectionMs + frame.overhead.refreshMs);
  });
  const noFrames = "Waiting for completed frame samples";
  return {
    frames,
    loading: readLoading(loading),
    events: readEvents(diagnostics.events, frames),
    ...judgeBudget(frames, budget, tolerance, workMs),
    tolerance,
    workMs,
    fps,
    average: frames.length ? measured(average) : unknown(noFrames),
    p95: p95 === undefined ? unknown(noFrames) : measured(p95),
    worst: worst ? measured(worst.interval) : unknown(noFrames),
    worstFrame: worst?.id ?? null,
    worstAge: latest && worst ? (latest.at - worst.at) / 1000 : null,
    windowSeconds:
      latest && frames[0] ? (latest.at - frames[0].at + frames[0].interval) / 1000 : null,
    cpu: [...cpu.values()],
    complete: complete.length,
    excluded: frames.length - complete.length,
    unattributed: complete.length
      ? measured(remainder)
      : unknown("No complete scope frames in this window"),
    gpu,
    counters: diagnostics.systems
      .map((system) => ({
        id: system.id,
        label: system.label,
        values: Object.entries(system.values).map(([name, value]) => ({
          name,
          ...formatCounter(name, value),
        })),
      }))
      .filter((system) => system.values.length > 0),
    recording: diagnostics.recording,
    capture: diagnostics.capture,
    overhead: {
      collection: frames.length ? measured(collection) : unknown(noFrames),
      refresh: frames.length ? measured(refresh) : unknown(noFrames),
      mean: frames.length ? measured(collection + refresh) : unknown(noFrames),
      peak: frames.length ? measured(peak) : unknown(noFrames),
    },
  };
}

export type LiveView = ReturnType<typeof readLive>;
