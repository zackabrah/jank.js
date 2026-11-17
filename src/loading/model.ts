export interface LoadingOperation {
  /** Stable within its stage. Offsets share the session's wall clock. */
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number | null;
  /** Running + null end also describes unfinished work at a sealed cutoff. */
  readonly status: "running" | "ready" | "failed" | "cancelled";
}

export interface LoadingStage {
  readonly stage: string;
  readonly count: number;
  readonly errors: number;
  readonly cancelled: number;
  readonly totalMs?: number | null;
  readonly busyMs?: number | null;
  readonly cacheHits?: number | null;
  readonly cacheMisses?: number | null;
  readonly cacheInflight?: number | null;
  readonly bytes?: number | null;
  /** Backend compilation work items, not bytes or GPU execution progress. */
  readonly compileProgress?: { readonly completed: number; readonly total: number } | null;
  /** May be partial; missing operations never become zero-length bars. */
  readonly operations?: readonly LoadingOperation[] | null;
}

/** Structural subset of preparation snapshots, with optional host timing detail. */
export interface LoadingSession {
  readonly id: number;
  readonly label: string;
  readonly kind: "fresh-context" | "repeat-session" | "editor";
  readonly status: "loading" | "ready" | "failed" | "cancelled";
  /** Elapsed session wall time, never a sum of operation durations. Null means unavailable. */
  readonly elapsedMs: number | null;
  /** Active operations now, or unfinished operations at a sealed session's cutoff. */
  readonly pending: number;
  readonly stages: readonly LoadingStage[];
  /** Same workload/backend/settings; matching display labels alone are insufficient. */
  readonly comparisonKey?: string | null;
  readonly failure?: string | null;
}

export interface LoadingSnapshot {
  readonly current: LoadingSession | null;
  /** Finished sessions, oldest first. The panel displays the latest eight plus current. */
  readonly history: readonly LoadingSession[];
}

const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const duration = (value: number) => Number.isFinite(value) && value >= 0;

function readSession(session: LoadingSession) {
  if (
    !count(session.id) ||
    session.id === 0 ||
    typeof session.label !== "string" ||
    !["fresh-context", "repeat-session", "editor"].includes(session.kind) ||
    !["loading", "ready", "failed", "cancelled"].includes(session.status) ||
    (session.elapsedMs !== null &&
      (!Number.isFinite(session.elapsedMs) || session.elapsedMs < 0)) ||
    !count(session.pending) ||
    (session.comparisonKey != null &&
      (typeof session.comparisonKey !== "string" || !session.comparisonKey.trim())) ||
    (session.failure != null && typeof session.failure !== "string")
  )
    throw new RangeError("Invalid loading session metadata");
  let total = 0,
    failed = 0,
    cancelled = 0;
  const names = new Set<string>();
  const failures: string[] = [];
  let observedRunning = 0,
    observedReady = 0;
  const stages = session.stages.map((stage) => {
    if (
      typeof stage.stage !== "string" ||
      !stage.stage.trim() ||
      names.has(stage.stage) ||
      !count(stage.count) ||
      !count(stage.errors) ||
      !count(stage.cancelled) ||
      stage.errors + stage.cancelled > stage.count
    )
      throw new RangeError("Invalid loading stage counts");
    names.add(stage.stage);
    total += stage.count;
    failed += stage.errors;
    cancelled += stage.cancelled;
    if (stage.errors) failures.push(`${stage.stage}: ${stage.errors}`);
    for (const value of [stage.totalMs, stage.busyMs])
      if (value != null && !duration(value)) throw new RangeError("Invalid loading duration");
    for (const value of [stage.cacheHits, stage.cacheMisses, stage.cacheInflight, stage.bytes])
      if (value != null && !count(value)) throw new RangeError("Invalid loading cache count");
    if (
      stage.compileProgress &&
      (!count(stage.compileProgress.completed) ||
        !count(stage.compileProgress.total) ||
        stage.compileProgress.completed > stage.compileProgress.total)
    )
      throw new RangeError("Invalid compilation progress");
    const ids = new Set<string>();
    const outcomes = { running: 0, ready: 0, failed: 0, cancelled: 0 };
    const operations = (stage.operations ?? []).map((operation) => {
      if (
        typeof operation.id !== "string" ||
        !operation.id.trim() ||
        ids.has(operation.id) ||
        !duration(operation.startMs) ||
        !["running", "ready", "failed", "cancelled"].includes(operation.status) ||
        (operation.status === "running"
          ? operation.endMs !== null
          : operation.endMs === null ||
            !duration(operation.endMs) ||
            operation.endMs < operation.startMs) ||
        (session.elapsedMs !== null && (operation.endMs ?? operation.startMs) > session.elapsedMs)
      )
        throw new RangeError("Invalid loading operation offsets or identity");
      ids.add(operation.id);
      outcomes[operation.status]++;
      return { ...operation };
    });
    if (
      operations.length > stage.count ||
      !duration(
        operations.reduce(
          (sum, operation) =>
            sum + ((operation.endMs ?? session.elapsedMs ?? operation.startMs) - operation.startMs),
          0,
        ),
      ) ||
      outcomes.failed > stage.errors ||
      outcomes.cancelled > stage.cancelled ||
      outcomes.ready + outcomes.running > stage.count - stage.errors - stage.cancelled
    )
      throw new RangeError("Loading operation outcomes exceed stage counts");
    observedRunning += outcomes.running;
    observedReady += outcomes.ready;
    return {
      stage: stage.stage,
      count: stage.count,
      errors: stage.errors,
      cancelled: stage.cancelled,
      totalMs: stage.totalMs ?? null,
      busyMs: stage.busyMs ?? null,
      cacheHits: stage.cacheHits ?? null,
      cacheMisses: stage.cacheMisses ?? null,
      cacheInflight: stage.cacheInflight ?? null,
      bytes: stage.bytes ?? null,
      compileProgress: stage.compileProgress ? { ...stage.compileProgress } : null,
      operations,
    };
  });
  if (
    !count(total) ||
    failed + cancelled + session.pending > total ||
    observedRunning > session.pending ||
    observedReady > total - failed - cancelled - session.pending
  )
    throw new RangeError("Loading outcomes exceed the reported operations");
  for (const key of ["cacheHits", "cacheMisses", "cacheInflight", "bytes"] as const)
    if (!count(stages.reduce((sum, stage) => sum + (stage[key] ?? 0), 0)))
      throw new RangeError("Loading cache total exceeds safe precision");
  return {
    id: session.id,
    label: session.label,
    kind: session.kind,
    status: session.status,
    elapsedMs: session.elapsedMs,
    pending: session.pending,
    total,
    failed,
    cancelled,
    completed: total - failed - cancelled - session.pending,
    failures,
    failure: session.failure ?? null,
    comparisonKey: session.comparisonKey ?? null,
    stages,
  };
}

export function readLoading(snapshot: LoadingSnapshot | null | undefined) {
  if (snapshot == null) return null;
  const ids = new Set<number>();
  let previous = 0;
  for (const session of snapshot.history) {
    if (ids.has(session.id) || session.id <= previous || session.status === "loading")
      throw new RangeError("Loading history needs ordered, unique, finished sessions");
    ids.add(session.id);
    previous = session.id;
  }
  const current = snapshot.current ? readSession(snapshot.current) : null;
  const history = snapshot.history.slice(-8).map(readSession);
  // A sealed current session may also be in history; the current snapshot wins.
  const sessions = history.filter((session) => session.id !== current?.id);
  if (current) sessions.push(current);
  sessions.sort((a, b) => a.id - b.id);
  return { sessions, latest: current ?? sessions.at(-1) ?? null };
}

export type LoadingView = NonNullable<ReturnType<typeof readLoading>>;
export type LoadingSessionView = ReturnType<typeof readSession>;
