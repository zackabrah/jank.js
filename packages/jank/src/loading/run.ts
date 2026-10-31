import type {
  LoadingOperation,
  LoadingOutcome,
  LoadingRun,
  LoadingSnapshot,
  LoadingStage,
} from "./loading.ts";

interface StageState {
  name: string;
  operationCount: number;
  failedCount: number;
  cancelledCount: number;
  totalMs: number;
  busyMs: number;
  receivedBytes: number;
  cache: { hits: number; misses: number; inFlight: number };
  active: number;
  activeStartedAtSumMs: number;
  busyStartedAtMs: number;
}

export function copyLoading(snapshot: LoadingSnapshot): LoadingSnapshot {
  return {
    ...snapshot,
    stages: snapshot.stages.map((stage) => ({ ...stage, cache: { ...stage.cache } })),
  };
}

export function loadingLabel(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 240) {
    throw new RangeError(`Loading ${field} must contain 1–240 characters`);
  }
  return value;
}

function outcomeOf(error: unknown): LoadingOutcome {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
    ? "cancelled"
    : "failed";
}

function snapshotStage(stage: StageState, atMs: number): LoadingStage {
  return {
    name: stage.name,
    operationCount: stage.operationCount,
    failedCount: stage.failedCount,
    cancelledCount: stage.cancelledCount,
    totalMs: stage.totalMs + stage.active * atMs - stage.activeStartedAtSumMs,
    busyMs: stage.busyMs + (stage.active ? atMs - stage.busyStartedAtMs : 0),
    receivedBytes: stage.receivedBytes,
    cache: { ...stage.cache },
  };
}

export interface RunOptions {
  readonly id: number;
  readonly label: string;
  readonly kind: LoadingSnapshot["kind"];
  readonly startedAtMs: number;
  readonly now: () => number;
  readonly maxStages: number;
  readonly maxOperations: number;
  readonly onFinish: (snapshot: LoadingSnapshot) => void;
}

/** Owns one run and its streaming interval union; completed operations require no retained spans. */
export class LoadingRunState implements LoadingRun {
  private readonly stages = new Map<string, StageState>();
  private pending = 0;
  private operations = 0;
  private sealed: LoadingSnapshot | null = null;
  private invalid = false;

  private readonly options: RunOptions;

  constructor(options: RunOptions) {
    this.options = options;
  }

  snapshot(atMs: number): LoadingSnapshot {
    if (this.sealed) {
      return copyLoading(this.sealed);
    }
    return {
      id: this.options.id,
      label: this.options.label,
      kind: this.options.kind,
      status: "loading",
      elapsedMs: atMs - this.options.startedAtMs,
      pendingOperations: this.pending,
      stages: [...this.stages.values()].map((stage) => snapshotStage(stage, atMs)),
    };
  }

  invalidate(): void {
    this.invalid = true;
  }

  private active(): boolean {
    return !this.invalid && !this.sealed;
  }

  startStage(name: string): LoadingOperation {
    if (!this.active()) {
      return { addReceivedBytes() {}, recordCache() {}, finish() {} };
    }
    loadingLabel(name, "stage");
    if (this.operations >= this.options.maxOperations) {
      throw new RangeError("Loading operation capacity reached");
    }
    let stage = this.stages.get(name);
    if (!stage && this.stages.size >= this.options.maxStages) {
      throw new RangeError("Loading stage capacity reached");
    }
    const startedAtMs = this.options.now();
    if (!stage) {
      stage = {
        name,
        operationCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        totalMs: 0,
        busyMs: 0,
        receivedBytes: 0,
        cache: { hits: 0, misses: 0, inFlight: 0 },
        active: 0,
        activeStartedAtSumMs: 0,
        busyStartedAtMs: startedAtMs,
      };
      this.stages.set(name, stage);
    }
    if (stage.active === 0) {
      stage.busyStartedAtMs = startedAtMs;
    }
    stage.active += 1;
    stage.activeStartedAtSumMs += startedAtMs;
    stage.operationCount += 1;
    this.pending += 1;
    this.operations += 1;
    return this.operation(stage, startedAtMs);
  }

  private operation(stage: StageState, startedAtMs: number): LoadingOperation {
    let finished = false;
    return {
      addReceivedBytes: (bytes) => {
        if (finished || !this.active()) {
          return;
        }
        if (
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          !Number.isSafeInteger(stage.receivedBytes + bytes)
        ) {
          throw new RangeError("Loading bytes must be nonnegative safe integers within capacity");
        }
        stage.receivedBytes += bytes;
      },
      recordCache: (outcome) => {
        if (finished || !this.active()) {
          return;
        }
        if (outcome === "hit") {
          stage.cache.hits += 1;
        } else if (outcome === "miss") {
          stage.cache.misses += 1;
        } else if (outcome === "in-flight") {
          stage.cache.inFlight += 1;
        } else {
          throw new RangeError("Unknown loading cache outcome");
        }
      },
      finish: (outcome = "ready") => {
        if (finished || !this.active()) {
          return;
        }
        validateOutcome(outcome);
        const atMs = this.options.now();
        finished = true;
        stage.totalMs += atMs - startedAtMs;
        stage.activeStartedAtSumMs -= startedAtMs;
        stage.active -= 1;
        this.pending -= 1;
        if (stage.active === 0) {
          stage.busyMs += atMs - stage.busyStartedAtMs;
        }
        if (outcome === "failed") {
          stage.failedCount += 1;
        }
        if (outcome === "cancelled") {
          stage.cancelledCount += 1;
        }
      },
    };
  }

  measure<T>(name: string, work: () => T): T {
    const operation = this.startStage(name);
    try {
      const result = work();
      if (isPromiseLike(result)) {
        void Promise.resolve(result).then(
          () => operation.finish(),
          (error) => operation.finish(outcomeOf(error)),
        );
      } else {
        operation.finish();
      }
      return result;
    } catch (error) {
      operation.finish(outcomeOf(error));
      throw error;
    }
  }

  finish(outcome: LoadingOutcome): void {
    if (!this.active()) {
      return;
    }
    validateOutcome(outcome);
    this.sealed = { ...this.snapshot(this.options.now()), status: outcome };
    this.options.onFinish(copyLoading(this.sealed));
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}
function validateOutcome(outcome: LoadingOutcome): void {
  if (outcome !== "ready" && outcome !== "failed" && outcome !== "cancelled") {
    throw new RangeError("Unknown loading outcome");
  }
}
