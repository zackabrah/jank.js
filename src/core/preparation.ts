/** Loading observations belong to one explicit host owner; no global clock or cache is installed. */
export const defaultPreparationStages = [
  "device",
  "document",
  "fetch",
  "model-decode",
  "texture-decode",
  "material-preparation",
  "scene-preparation",
  "spatial-preparation",
  "pipeline-compile",
  "warmup",
  "first-frame",
] as const;

export type PreparationStage = string;

export type PreparationKind = "fresh-context" | "repeat-session" | "editor";

export type PreparationStatus = "ready" | "failed" | "cancelled";

export type PreparationCacheOutcome = "hit" | "miss" | "inflight";

export interface PreparationStageSnapshot {
  readonly stage: PreparationStage;
  readonly count: number;
  readonly errors: number;
  readonly cancelled: number;
  /** Sum of operation elapsed times; overlapping work is intentionally non-additive. */
  readonly totalMs: number;
  /** Union of intervals with at least one operation active in this stage. Not CPU/GPU execution time. */
  readonly busyMs: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly cacheInflight: number;
  /** Response-body bytes actually received by this owner, including HTTP/browser-cache responses. */
  readonly bytes: number;
}

export interface PreparationSnapshot {
  readonly id: number;
  readonly label: string;
  readonly kind: PreparationKind;
  readonly status: "loading" | PreparationStatus;
  readonly elapsedMs: number;
  /** Active operations now, or at the finish cutoff for a sealed run. */
  readonly pending: number;
  readonly stages: readonly PreparationStageSnapshot[];
}

export interface PreparationRecorder {
  begin(stage: PreparationStage): (status?: PreparationStatus) => void;

  /** Measures sync work or promise settlement, preserving the returned value and original error. */
  measure<T>(stage: PreparationStage, work: () => T, signal?: AbortSignal): T;

  cache(stage: PreparationStage, outcome: PreparationCacheOutcome): void;

  bytes(stage: PreparationStage, bytes: number): void;
}

export interface PreparationProfiler extends PreparationRecorder {
  /** Superseding an unfinished run seals it as cancelled. */
  start(options: {
    readonly label: string;
    readonly kind: PreparationKind;
  }): number;

  /** Bind nested async work to this run so stale completions never enter a replacement run. */
  capture(): PreparationRecorder;

  /** Seals observations at this instant. Pending work is reported; late completions are ignored. */
  finish(status: PreparationStatus): void;

  snapshot(): PreparationSnapshot | null;

  /** At most eight finished runs, oldest first; snapshots are detached from collector state. */
  history(): readonly PreparationSnapshot[];
}

interface StageState {
  stage: PreparationStage;
  count: number;
  errors: number;
  cancelled: number;
  totalMs: number;
  busyMs: number;
  cacheHits: number;
  cacheMisses: number;
  cacheInflight: number;
  bytes: number;
  active: number;
  busyStart: number;
}

interface Span {
  readonly stage: StageState;
  readonly start: number;
}

interface Run {
  readonly id: number;
  readonly label: string;
  readonly kind: PreparationKind;
  readonly start: number;
  readonly stages: Map<PreparationStage, StageState>;
  readonly active: Set<Span>;
  sealed?: PreparationSnapshot;
}

const noop = () => {};

const inert: PreparationRecorder = {
  begin: () => noop,
  measure: (_stage, work) => work(),
  cache: noop,
  bytes: noop,
};

const copy = (snapshot: PreparationSnapshot): PreparationSnapshot => ({
  ...snapshot,
  stages: snapshot.stages.map((stage) => ({ ...stage })),
});

function cancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function createPreparationProfiler(
  options: {
    readonly now?: () => number;
    readonly stages?: readonly string[];
  } = {},
): PreparationProfiler {
  const clock = options.now ?? (() => performance.now());

  let lastTime = 0;

  function now(): number {
    const time = clock();

    // A diagnostic clock must not inject NaN or negative intervals into production work.
    if (Number.isFinite(time)) lastTime = Math.max(lastTime, time);

    return lastTime;
  }

  let nextId = 0,
    current: Run | undefined;

  const finished: PreparationSnapshot[] = [];

  function snapshot(
    run: Run,
    time: number,
    status: PreparationSnapshot["status"],
  ): PreparationSnapshot {
    const orderedNames = new Set([
      ...(options.stages ?? defaultPreparationStages),
      ...run.stages.keys(),
    ]);

    const stages = [...orderedNames].flatMap((name) => {
      const stage = run.stages.get(name);

      if (!stage) return [];

      let pendingMs = 0;

      for (const span of run.active)
        if (span.stage === stage) pendingMs += time - span.start;

      return [
        {
          stage: name,
          count: stage.count,
          errors: stage.errors,
          cancelled: stage.cancelled,
          totalMs: stage.totalMs + pendingMs,
          busyMs:
            stage.busyMs + (stage.active > 0 ? time - stage.busyStart : 0),
          cacheHits: stage.cacheHits,
          cacheMisses: stage.cacheMisses,
          cacheInflight: stage.cacheInflight,
          bytes: stage.bytes,
        },
      ];
    });

    return {
      id: run.id,
      label: run.label,
      kind: run.kind,
      status,
      elapsedMs: time - run.start,
      pending: run.active.size,
      stages,
    };
  }

  function recorder(run: Run | undefined): PreparationRecorder {
    if (!run || run.sealed) return inert;

    function stageFor(stage: PreparationStage): StageState {
      if (!stage.trim()) throw new Error("Preparation stage must have a name");

      let result = run!.stages.get(stage);

      if (!result) {
        result = {
          stage,
          count: 0,
          errors: 0,
          cancelled: 0,
          totalMs: 0,
          busyMs: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheInflight: 0,
          bytes: 0,
          active: 0,
          busyStart: 0,
        };

        run!.stages.set(stage, result);
      }

      return result;
    }

    const result: PreparationRecorder = {
      begin(stage) {
        if (run.sealed) return noop;

        const start = now(),
          state = stageFor(stage),
          span = { stage: state, start };

        state.count++;

        if (state.active++ === 0) state.busyStart = start;

        run.active.add(span);

        let ended = false;

        return (status = "ready") => {
          if (ended || run.sealed) return;

          ended = true;

          const end = now();

          run.active.delete(span);

          state.totalMs += end - start;

          if (--state.active === 0) state.busyMs += end - state.busyStart;

          if (status === "failed") state.errors++;

          if (status === "cancelled") state.cancelled++;
        };
      },
      measure<T>(
        stage: PreparationStage,
        work: () => T,
        signal?: AbortSignal,
      ): T {
        const end = result.begin(stage);

        try {
          const value = work();

          if (
            value !== null &&
            (typeof value === "object" || typeof value === "function") &&
            "then" in value &&
            typeof value.then === "function"
          ) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This promise branch preserves the callback's fulfillment type; synchronous values return unchanged.
            return Promise.resolve(value).then(
              (resolved) => {
                end();

                return resolved;
              },
              (error: unknown) => {
                end(
                  signal?.aborted || cancellation(error)
                    ? "cancelled"
                    : "failed",
                );

                throw error;
              },
            ) as T;
          }

          end();

          return value;
        } catch (error) {
          end(signal?.aborted || cancellation(error) ? "cancelled" : "failed");

          throw error;
        }
      },
      cache(stage, outcome) {
        if (run.sealed) return;

        const state = stageFor(stage);

        if (outcome === "hit") state.cacheHits++;
        else if (outcome === "miss") state.cacheMisses++;
        else state.cacheInflight++;
      },
      bytes(stage, bytes) {
        if (run.sealed || !Number.isSafeInteger(bytes) || bytes < 0) return;

        stageFor(stage).bytes += bytes;
      },
    };

    return result;
  }

  function finish(status: PreparationStatus): void {
    if (!current || current.sealed) return;

    current.sealed = snapshot(current, now(), status);

    current.active.clear();

    finished.push(current.sealed);

    if (finished.length > 8) finished.shift();
  }

  return {
    start({ label, kind }) {
      finish("cancelled");

      current = {
        id: ++nextId,
        label: label.slice(0, 240),
        kind,
        start: now(),
        stages: new Map(),
        active: new Set(),
      };

      return current.id;
    },
    capture: () => recorder(current),
    begin: (stage) => recorder(current).begin(stage),
    measure: (stage, work, signal) =>
      recorder(current).measure(stage, work, signal),
    cache: (stage, outcome) => recorder(current).cache(stage, outcome),
    bytes: (stage, bytes) => recorder(current).bytes(stage, bytes),
    finish,
    snapshot: () =>
      current
        ? copy(current.sealed ?? snapshot(current, now(), "loading"))
        : null,
    history: () => finished.map(copy),
  };
}

/** Avoid profiling allocations when an owner did not opt in. */
export function measurePreparation<T>(
  recorder: PreparationRecorder | undefined,
  stage: PreparationStage,
  work: () => T,
  signal?: AbortSignal,
): T {
  return recorder ? recorder.measure(stage, work, signal) : work();
}
