import type {
  DiagnosticFrame,
  DiagnosticScope,
  PerformanceRecording,
} from "./recording-types.ts";

/** Length of a union: overlapping/nested intervals are counted once. */
export function intervalUnion(
  intervals: readonly { start: number; end: number }[],
): number {
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

  const available = frame.coverage !== "unavailable";

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
    explanation:
      frame.coverage === "unavailable"
        ? "This frame has no exact scope capture."
        : frame.coverage === "truncated"
          ? "Some scopes were omitted. Unattributed time includes omitted instrumentation."
          : "Unattributed frame interval may include browser work, scheduling, waiting or idle time. System durations are inclusive and may overlap.",
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

export function recordingSummary(recording: PerformanceRecording) {
  const frames = recording.frames,
    values = frames.map((frame) => frame.interval).toSorted((a, b) => a - b);

  const mean = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

  return {
    frames: frames.length,
    meanMs: mean,
    fps: mean ? 1000 / mean : null,
    p95Ms: values.length
      ? values[Math.floor((values.length - 1) * 0.95)]!
      : null,
    worstMs: values.at(-1) ?? null,
    overBudgetFrames: frames.filter(
      (frame) => frame.interval > recording.budget.frameMs,
    ).length,
  };
}

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
