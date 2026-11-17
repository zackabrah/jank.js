import { formatMs } from "../format.ts";
import type { LoadingSessionView, LoadingView } from "./model.ts";

type Interval = { start: number; end: number };

function union(intervals: readonly Interval[]) {
  const result: Interval[] = [];
  for (const interval of intervals.toSorted((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end)
      previous.end = Math.max(previous.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export function stageTiming(stage: LoadingSessionView["stages"][number], elapsedMs: number | null) {
  const intervals = stage.operations.flatMap((operation) => {
    const end = operation.endMs ?? elapsedMs;
    return end === null ? [] : [{ start: operation.startMs, end, status: operation.status }];
  });
  const wall = union(intervals);
  const complete = intervals.length === stage.count;
  return {
    finished: union(intervals.filter((interval) => interval.status !== "running")),
    running: union(intervals.filter((interval) => interval.status === "running")),
    all: wall,
    failures: stage.operations.filter((operation) => operation.status === "failed"),
    missing: stage.count - intervals.length,
    wallMs: complete
      ? wall.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
      : stage.busyMs,
    totalMs: complete
      ? intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
      : stage.totalMs,
  };
}

const successful = (session: LoadingSessionView) =>
  session.status === "ready" && !session.pending && !session.failed && !session.cancelled;

export function coldComparison(session: LoadingSessionView, model: LoadingView) {
  const cold =
    session.kind === "repeat-session" && session.comparisonKey
      ? (model.sessions.findLast(
          (run) =>
            run.id < session.id &&
            run.kind === "fresh-context" &&
            run.comparisonKey === session.comparisonKey &&
            successful(run),
        ) ?? null)
      : null;
  const delta =
    cold?.elapsedMs != null && session.elapsedMs !== null && successful(session)
      ? session.elapsedMs - cold.elapsedMs
      : null;
  const percent = delta !== null && cold?.elapsedMs ? (delta / cold.elapsedMs) * 100 : NaN;
  return {
    cold,
    delta,
    percent: Number.isFinite(percent) ? percent : null,
  };
}

export function cacheSummary(session: LoadingSessionView) {
  if (
    !session.stages.length ||
    session.stages.some(
      (stage) =>
        stage.cacheHits === null || stage.cacheMisses === null || stage.cacheInflight === null,
    )
  )
    return null;
  const hits = session.stages.reduce((sum, stage) => sum + (stage.cacheHits ?? 0), 0);
  const total = session.stages.reduce(
    (sum, stage) =>
      sum + (stage.cacheHits ?? 0) + (stage.cacheMisses ?? 0) + (stage.cacheInflight ?? 0),
    0,
  );
  if (!Number.isSafeInteger(total)) return null;
  return { hits, total, percent: total ? (hits / total) * 100 : null };
}

export const loadingTime = (ms: number | null) => (ms === null ? "Unknown" : formatMs(ms));
