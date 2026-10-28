import { msPerSecond, toolEvent, unavailableCoverage } from "./recording.ts";

import type {
  DiagnosticFrame,
  DiagnosticScope,
  PerformanceRecording,
} from "./recording-types.ts";

// The rank in sorted frame intervals reported as p95, by both the panel and the viewer.
const p95Rank = 0.95;

// Event labels listed for a capture.
const nearEventLimit = 3;

/** The monitor's own lifecycle markers; never offered as the event near a capture. */
const toolEvents = new Set<string>(Object.values(toolEvent));

// Fixed icons for the monitor's own events.
const toolGlyphs = new Map<string, string>([
  [toolEvent.recordingStarted, "●"],
  [toolEvent.recordingStopped, "■"],
  [toolEvent.recordingComplete, "■"],
  [toolEvent.spikeCaptured, "▲"],
]);

// Icons for host events: shapes and maths symbols that common monospace fonts carry and that
// never render as colour emoji, none shared with the monitor's own events.
const hostGlyphs = ["◆", "◇", "○", "□", "△", "▽", "◊", "∗", "×", "+", "∆", "≡"];

const knownGlyphs = new Set([...toolGlyphs.values(), ...hostGlyphs]);

const glyphSeparator = " ";

// 32-bit FNV-1a, a small stable hash: the same label always gets the same icon.
const fnvOffset = 0x81_1c_9d_c5,
  fnvPrime = 0x01_00_01_93;

const explanations: Record<DiagnosticFrame["coverage"], string> = {
  unavailable: "This frame has no exact scope capture.",
  truncated:
    "Some scopes were omitted. Unattributed time includes omitted instrumentation.",
  complete:
    "Unattributed frame interval may include browser work, scheduling, waiting or idle time. System durations are inclusive and may overlap.",
};

/** Length of a union: overlapping/nested intervals are counted once. */
export function intervalUnion(
  intervals: readonly { start: number; end: number }[],
): number {
  // Sort intervals by start time, then merge overlapping intervals and sum their lengths
  const sorted = intervals.toSorted((a, b) => a.start - b.start);

  let start = 0,
    end = 0,
    total = 0,
    first = true;

  for (const interval of sorted) {
    if (first) {
      start = interval.start;

      end = interval.end;

      first = false;
    } else if (interval.start > end) {
      total += end - start;

      start = interval.start;

      end = interval.end;
    } else end = Math.max(end, interval.end);
  }

  return total + (first ? 0 : end - start);
}

/** Breaks one frame down into per-system timings, nearby events and GPU samples; null for an unknown id. */
export function inspectFrame(recording: PerformanceRecording, frameId: number) {
  const frame = recording.frames.find((item) => item.id === frameId);

  if (!frame) return null;

  const start = frame.at - frame.interval;

  const groups = new Map<
    string,
    { label: string; scopes: DiagnosticScope[] }
  >();

  for (const scope of frame.scopes) {
    let group = groups.get(scope.system);

    if (!group) {
      group = { label: scope.label, scopes: [] };

      groups.set(scope.system, group);
    }

    group.scopes.push(scope);
  }

  const available = frame.coverage !== unavailableCoverage;

  const trackedMs = available ? intervalUnion(frame.scopes) : null;

  const systemTimings = [...groups]
    .map(([id, group]) => ({
      id,
      label: group.label,
      inclusiveMs: intervalUnion(group.scopes),
      scopes: group.scopes.length,
    }))
    .toSorted((a, b) => b.inclusiveMs - a.inclusiveMs);

  const periodic = recording.samples.findLast(
    (sample) => sample.at <= frame.at,
  );

  return {
    frame,
    start,
    trackedMs,
    unattributedMs:
      trackedMs === null ? null : Math.max(0, frame.interval - trackedMs),
    attribution: frame.coverage,
    explanation: explanations[frame.coverage],
    systemTimings,
    events: recording.events.filter(
      (event) => event.at >= start && event.at < frame.at,
    ),
    periodicSystems: periodic
      ? {
          at: periodic.at,
          ageMs: frame.at - periodic.at,
          systems: periodic.systems,
        }
      : null,
    gpu:
      recording.gpu?.samples.filter(
        (sample) => sample.diagnosticFrame === frame.id,
      ) ?? [],
    budgetMs: recording.budget.frameMs,
    overBudgetMs: Math.max(0, frame.interval - recording.budget.frameMs),
  };
}

/** Headline frame statistics: count, mean, fps, p95, worst and frames over budget. */
export function recordingSummary(recording: PerformanceRecording) {
  const frames = recording.frames,
    values = frames.map((frame) => frame.interval).toSorted((a, b) => a - b);

  const mean = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

  return {
    frames: frames.length,
    meanMs: mean,
    fps: mean ? msPerSecond / mean : null,
    p95Ms: values.length ? sortedP95(values) : null,
    worstMs: values.at(-1) ?? null,
    overBudgetFrames: frames.filter(
      (frame) => frame.interval > recording.budget.frameMs,
    ).length,
  };
}

/** Frames that overlap the [start, end] timeline window; throws on an invalid window. */
export function selectFrameRange(
  recording: PerformanceRecording,
  start: number,
  end: number,
): DiagnosticFrame[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new RangeError("Invalid timeline range");

  return recording.frames.filter(
    (frame) => frame.at >= start && frame.at - frame.interval <= end,
  );
}

/** The p95 of values sorted ascending; the caller ensures there is at least one. */
export const sortedP95 = (sorted: ArrayLike<number>) =>
  sorted[Math.floor((sorted.length - 1) * p95Rank)]!;

/** A frame's scopes grouped by system, in first-seen order. */
export function scopesBySystem(scopes: readonly DiagnosticScope[]) {
  const groups = new Map<string, DiagnosticScope[]>();

  for (const scope of scopes) {
    let group = groups.get(scope.system);

    if (!group) groups.set(scope.system, (group = []));

    group.push(scope);
  }

  return groups;
}

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

/** Up to three host event labels near frame index `at`, for a capture's summary line. */
export function nearbyEventLabels(recording: PerformanceRecording, at: number) {
  const labels = eventsNear(recording, at)
    .filter((event) => !toolEvents.has(event.label))
    .map((event) => iconLabel(event.label));

  return labels.length
    ? labels.slice(0, nearEventLimit).join(" · ")
    : "no event nearby";
}

/**
 * An event's icon and the text to show beside it. The monitor's own events have fixed icons.
 * A label that starts with one of the icons and a space keeps that icon. Any other label gets
 * one worked out from its text, so it looks the same in the panel, recordings and the viewer.
 */
export function eventGlyph(label: string) {
  const fixed = toolGlyphs.get(label);

  if (fixed) return { glyph: fixed, text: label };

  const [first = ""] = label;

  if (knownGlyphs.has(first) && label[first.length] === glyphSeparator)
    return { glyph: first, text: label.slice(first.length + 1) };

  let hash = fnvOffset;

  for (const char of label)
    hash = Math.imul(hash ^ char.codePointAt(0)!, fnvPrime) >>> 0;

  return { glyph: hostGlyphs[hash % hostGlyphs.length]!, text: label };
}

/** An event label as shown to people: its icon, a space and its text. */
export function iconLabel(label: string) {
  const { glyph, text } = eventGlyph(label);

  return `${glyph} ${text}`;
}
