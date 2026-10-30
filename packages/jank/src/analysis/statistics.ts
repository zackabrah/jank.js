import type { FrameSample, ScopeSample } from "../core/frames.ts";

export interface FrameStatistics {
  readonly fps: number | null;
  readonly fpsRange: { readonly low: number; readonly high: number } | null;
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly worstFrameId: number;
  readonly missedFrames: number;
  readonly budgetMs: number;
  readonly limitMs: number;
  /** An interval-step estimate, not a calibrated clock measurement. */
  readonly estimatedTickMs: number | null;
}

export interface ScopeStatistics {
  readonly measuredFrames: number;
  readonly excludedFrames: number;
  readonly channels: readonly { readonly channelId: string; readonly averageMs: number }[];
  readonly unattributedMs: number | null;
}

/** Union of trusted measured intervals. Sorting never changes caller-owned data. */
export function intervalUnion(
  intervals: readonly Pick<ScopeSample, "startedAtMs" | "endedAtMs">[],
): number {
  let endMs = -Infinity;
  let totalMs = 0;
  for (const interval of intervals.toSorted(
    (left, right) => left.startedAtMs - right.startedAtMs,
  )) {
    const startMs = Math.max(endMs, interval.startedAtMs);
    totalMs += Math.max(0, interval.endedAtMs - startMs);
    endMs = Math.max(endMs, interval.endedAtMs);
  }
  return totalMs;
}

/** Uses sealed observations only; the p95 rank preserves the reference's floor convention. */
export function summarizeFrames(
  frames: readonly FrameSample[],
  targetFps: number,
  timerResolutionMs?: number,
): FrameStatistics | null {
  const first = frames[0];
  if (!first) {
    return null;
  }
  const durations = frames
    .map((frame) => frame.endedAtMs - frame.startedAtMs)
    .sort((a, b) => a - b);
  const estimatedTickMs = timerResolutionMs ?? estimateTick(durations);
  const budgetMs = 1000 / targetFps;
  const limitMs = budgetMs + 2 * (estimatedTickMs ?? 0);
  let worst = first;
  let averageMs = 0;
  let count = 0;
  for (const frame of frames) {
    const durationMs = frame.endedAtMs - frame.startedAtMs;
    // A running mean avoids overflowing a sum of finite measurements.
    count += 1;
    averageMs += (durationMs - averageMs) / count;
    if (durationMs > worst.endedAtMs - worst.startedAtMs) {
      worst = frame;
    }
  }
  return {
    ...frameRates(frames, first.startedAtMs),
    averageMs,
    p95Ms: durations[Math.floor((durations.length - 1) * 0.95)] ?? 0,
    worstMs: worst.endedAtMs - worst.startedAtMs,
    worstFrameId: worst.id,
    missedFrames: durations.filter((durationMs) => durationMs > limitMs).length,
    budgetMs,
    limitMs,
    estimatedTickMs,
  };
}

function estimateTick(sorted: readonly number[]): number | null {
  let tickMs = Infinity;
  let previousMs: number | null = null;
  for (const durationMs of sorted) {
    if (previousMs !== null) {
      const stepMs = durationMs - previousMs;
      if (stepMs >= 0.001) {
        tickMs = Math.min(tickMs, stepMs);
      }
    }
    previousMs = durationMs;
  }
  return Number.isFinite(tickMs) ? Math.min(1, tickMs) : null;
}

function frameRates(
  frames: readonly FrameSample[],
  startedAtMs: number,
): Pick<FrameStatistics, "fps" | "fpsRange"> {
  let segmentStartMs = startedAtMs;
  let from = 0;
  let fps: number | null = null;
  let low = Infinity;
  let high = 0;
  frames.forEach((frame, index) => {
    const previous = frames[index - 1];
    if (previous && previous.endedAtMs !== frame.startedAtMs) {
      segmentStartMs = frame.startedAtMs;
      from = index;
    }
    const cutoffMs = frame.endedAtMs - 1000;
    fps = null;
    if (cutoffMs < segmentStartMs) {
      return;
    }
    while ((frames[from]?.endedAtMs ?? Infinity) <= cutoffMs) {
      from += 1;
    }
    fps = index - from + 1;
    low = Math.min(low, fps);
    high = Math.max(high, fps);
  });
  return { fps, fpsRange: Number.isFinite(low) ? { low, high } : null };
}

export function summarizeScopes(frames: readonly FrameSample[]): ScopeStatistics {
  const complete = frames.filter((frame) => frame.coverage.status === "complete");
  const totals = new Map<string, number>();
  let unattributedMs = 0;
  for (const frame of complete) {
    const groups = new Map<string, ScopeSample[]>();
    for (const scope of frame.scopes) {
      const group = groups.get(scope.channelId) ?? [];
      group.push(scope);
      groups.set(scope.channelId, group);
    }
    for (const [channelId, intervals] of groups) {
      totals.set(
        channelId,
        (totals.get(channelId) ?? 0) + intervalUnion(intervals) / complete.length,
      );
    }
    unattributedMs +=
      Math.max(0, frame.endedAtMs - frame.startedAtMs - intervalUnion(frame.scopes)) /
      complete.length;
  }
  return {
    measuredFrames: complete.length,
    excludedFrames: frames.length - complete.length,
    channels: [...totals].map(([channelId, averageMs]) => ({ channelId, averageMs })),
    unattributedMs: complete.length > 0 ? unattributedMs : null,
  };
}
