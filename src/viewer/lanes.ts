import { intervalUnion } from "../core/inspection.ts";

import { count, fixed, timerHonesty, words } from "../performance/ui/format.ts";

import type {
  DiagnosticScope,
  PerformanceRecording,
  RecordingMetadata,
} from "../core/recording-types.ts";

/** One value per frame, by frame index; NaN where the recording has no value. */
export interface Lane {
  id: string;
  label: string;
  values: Float64Array;
}

export interface Lanes {
  ids: number[];
  index: Map<number, number>;
  intervals: Float64Array;
  /** Exact per frame: union of each system's scopes, NaN without scope capture. */
  cpu: Lane[];
  unattributed: Float64Array;
  /** The tool's own synchronous cost in each frame: collection plus refresh. */
  overhead: Float64Array;
  /** Placed at the frame that produced the sample; NaN between samples. */
  gpu: Lane[];
  /** Frames after the source frame at which each GPU sample was read back. */
  gpuAge: Float64Array;
  gpuUnlinked: number;
  /** Periodic snapshots, placed at the frame they were taken; NaN between them. */
  counters: Lane[];
  medians: Map<string, number>;
}

/** Recording-order lane data, computed once per load. */
export function buildLanes(recording: PerformanceRecording): Lanes {
  const frames = recording.frames;

  const n = frames.length;

  const index = new Map(frames.map((frame, i) => [frame.id, i]));

  const lane = (id: string, label: string): Lane => ({
    id,
    label,
    values: new Float64Array(n).fill(Number.NaN),
  });

  const cpu = new Map<string, Lane>(
    recording.systems.map((system) => [
      system.id,
      lane(system.id, system.label),
    ]),
  );

  const unattributed = new Float64Array(n).fill(Number.NaN);

  const overhead = new Float64Array(n);

  const intervals = new Float64Array(n);

  frames.forEach((frame, i) => {
    intervals[i] = frame.interval;

    overhead[i] = frame.overhead.collectionMs + frame.overhead.refreshMs;

    if (frame.coverage === "unavailable") return;

    const groups = new Map<string, DiagnosticScope[]>();

    for (const scope of frame.scopes) {
      let group = groups.get(scope.system);

      if (!group) groups.set(scope.system, (group = []));

      group.push(scope);
    }

    for (const entry of cpu.values()) entry.values[i] = 0;

    for (const [system, group] of groups) {
      let entry = cpu.get(system);

      if (!entry) {
        cpu.set(system, (entry = lane(system, group[0]!.label)));

        for (let j = 0; j <= i; j++)
          if (frames[j]!.coverage !== "unavailable") entry.values[j] = 0;
      }

      entry.values[i] = intervalUnion(group);
    }

    unattributed[i] = Math.max(0, frame.interval - intervalUnion(frame.scopes));
  });

  // Systems registered for counters only, never timed, have no CPU lane.
  const timed = [...cpu.values()].filter((entry) =>
    entry.values.some((value) => value > 0),
  );

  const gpu = new Map<string, Lane>();

  const gpuAge = new Float64Array(n).fill(Number.NaN);

  let gpuUnlinked = 0;

  for (const sample of recording.gpu?.samples ?? []) {
    const at =
      sample.diagnosticFrame == null
        ? undefined
        : index.get(sample.diagnosticFrame);

    if (at === undefined) {
      gpuUnlinked++;

      continue;
    }

    gpuAge[at] = sample.sampleAgeFrames ?? Number.NaN;

    for (const pass of sample.passes) {
      let entry = gpu.get(pass.label);

      if (!entry) gpu.set(pass.label, (entry = lane(pass.label, pass.label)));

      if (pass.milliseconds !== null) entry.values[at] = pass.milliseconds;
    }
  }

  const counters = new Map<string, Lane>();

  let frame = 0;

  for (const sample of recording.samples) {
    while (frame < n - 1 && frames[frame]!.at < sample.at) frame++;

    for (const system of sample.systems)
      for (const [key, value] of Object.entries(system.values)) {
        if (typeof value !== "number") continue;

        const id = `${system.id}:${key}`;

        let entry = counters.get(id);

        if (!entry) counters.set(id, (entry = lane(id, words(key))));

        entry.values[frame] = value;
      }
  }

  const medians = new Map<string, number>();

  for (const entry of timed) {
    const sorted = entry.values
      .filter((value) => !Number.isNaN(value))
      .toSorted();

    if (sorted.length) medians.set(entry.id, sorted[sorted.length >> 1]!);
  }

  return {
    ids: frames.map((item) => item.id),
    index,
    intervals,
    cpu: timed,
    unattributed,
    overhead,
    gpu: [...gpu.values()],
    gpuAge,
    gpuUnlinked,
    counters: [...counters.values()],
    medians,
  };
}

/** The two counters drawn as lanes: draw calls and objects when present. */
export function primaryCounters(lanes: Lanes): Lane[] {
  const preferred = ["draw calls", "objects"].flatMap((label) =>
    lanes.counters.filter((entry) => entry.label === label).slice(0, 1),
  );

  return (preferred.length ? preferred : lanes.counters).slice(0, 2);
}

/**
 * LIKELY, a heuristic: the scope furthest above its own median across the recording.
 * Null when no scope is above its median in this frame.
 */
export function likelyScope(lanes: Lanes, at: number) {
  let best: { label: string; id: string; delta: number } | null = null;

  for (const entry of lanes.cpu) {
    const value = entry.values[at]!;

    const median = lanes.medians.get(entry.id);

    if (Number.isNaN(value) || median === undefined) continue;

    const delta = value - median;

    if (delta > 0.05 && (!best || delta > best.delta))
      best = { label: entry.label, id: entry.id, delta };
  }

  return best;
}

export interface CaptureMark {
  rank: number;
  at: number;
  id: number;
  ms: number;
  near: string;
}

const toolEvents = new Set([
  "Spike captured",
  "Recording started",
  "Recording stopped",
  "Recording complete",
]);

/** Events inside the frames `at - reach` to `at + reach`, with signed frame offsets. */
export function eventsNear(
  recording: PerformanceRecording,
  at: number,
  reach = 10,
) {
  const frames = recording.frames;

  const first = frames[Math.max(0, at - reach)]!,
    last = frames[Math.min(frames.length - 1, at + reach)]!;

  const from = first.at - first.interval;

  let frame = Math.max(0, at - reach);

  return recording.events
    .filter((event) => event.at >= from && event.at <= last.at)
    .map((event) => {
      while (frame < frames.length - 1 && frames[frame]!.at < event.at) frame++;

      return { offset: frame - at, label: event.label, detail: event.detail };
    });
}

/**
 * Frames that crossed the capture threshold. In an automatic recording that is the
 * monitor's rule, a cooldown apart. Otherwise every spike counts once: frames over the
 * threshold within ten frames of each other are one spike, kept at its longest frame.
 * Ranked by frame time, longest first.
 */
export function findCaptures(recording: PerformanceRecording, limit = 50) {
  const { capture, budget, frames } = recording;

  const automatic = capture.mode === "automatic";

  const threshold = capture.thresholdMs ?? budget.frameMs * 2;

  const marks: Omit<CaptureMark, "rank" | "near">[] = [];

  let next = -Infinity;

  frames.forEach((frame, at) => {
    const trigger = frame.id === capture.triggerFrame;

    if (!trigger && frame.interval <= threshold) return;

    const last = marks.at(-1);

    if (automatic) {
      if (!trigger && frame.at < next) return;

      next = frame.at + capture.cooldownMs;
    } else if (last && at - last.at <= 10) {
      if (frame.interval > last.ms)
        Object.assign(last, { at, id: frame.id, ms: frame.interval });

      return;
    }

    marks.push({ at, id: frame.id, ms: frame.interval });
  });

  const ranked = marks
    .toSorted((a, b) => b.ms - a.ms)
    .slice(0, limit)
    .map((mark, i): CaptureMark => {
      const near = eventsNear(recording, mark.at)
        .filter((event) => !toolEvents.has(event.label))
        .map((event) => event.label);

      return {
        at: mark.at,
        id: mark.id,
        ms: mark.ms,
        rank: i + 1,
        near: near.length ? near.slice(0, 3).join(" · ") : "no event nearby",
      };
    });

  return {
    rule: automatic
      ? `auto · threshold ${fixed(threshold)} ms · ${capture.beforeFrames} before, ${capture.afterFrames} after`
      : `${capture.mode} · frames over ${fixed(threshold)} ms`,
    marks: ranked,
  };
}

function browserName(agent: string | null) {
  if (!agent) return "browser unknown";

  const match =
    /(Edg|Firefox|Chrome)\/(\d+)/.exec(agent) ??
    /Version\/(\d+).*(Safari)/.exec(agent);

  if (!match) return "browser unknown";

  return match[2] === "Safari"
    ? `Safari ${match[1]}`
    : `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2]}`;
}

/** The recording's metadata in one line, as the core exported it. */
export function environmentLine(recording: PerformanceRecording, lanes: Lanes) {
  const { metadata }: { metadata: RecordingMetadata } = recording;

  const environment = metadata.environment;

  const viewport = environment.viewport;

  const honesty = timerHonesty(environment);

  const instrumented = [
    lanes.cpu.length ? "cpu" : "",
    lanes.gpu.length ? "gpu" : "",
    lanes.counters.length ? "counters" : "",
    metadata.devTools ? "devtools" : "",
  ].filter(Boolean);

  return [
    `jank.js ${metadata.jankVersion ?? "unknown"}`,
    metadata.application
      ? `${metadata.application.name} ${metadata.application.version ?? ""}`.trim()
      : "app unknown",
    browserName(environment.userAgent),
    environment.platform ?? "platform unknown",
    viewport
      ? `${viewport.width}×${viewport.height} @${viewport.pixelRatio}`
      : "viewport unknown",
    honesty.cpu,
    honesty.gpu,
    `instrumented: ${instrumented.length ? instrumented.join(", ") : "frames only"}`,
  ].join(" · ");
}

export function span(recording: PerformanceRecording) {
  const first = recording.frames[0],
    last = recording.frames.at(-1);

  if (!first || !last) return "0 s";

  const seconds = (last.at - (first.at - first.interval)) / 1000;

  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${seconds.toFixed(1)} s`;
}

export const frames = (value: number) => `${count(value)} frames`;
