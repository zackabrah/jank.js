export type LoadingOutcome = "ready" | "failed" | "cancelled";

export interface LoadingStage {
  readonly name: string;
  readonly operationCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  /** Sum of elapsed operation time, including overlap; not CPU execution time. */
  readonly totalMs: number;
  /** Union of the stage's elapsed intervals. */
  readonly busyMs: number;
  readonly receivedBytes: number;
  readonly cache: { readonly hits: number; readonly misses: number; readonly inFlight: number };
}

export interface LoadingSnapshot {
  readonly id: number;
  readonly label: string;
  readonly kind: "fresh-context" | "repeat-session" | "editor";
  readonly status: "loading" | LoadingOutcome;
  readonly elapsedMs: number;
  /** Active now, or still pending at the seal cutoff. */
  readonly pendingOperations: number;
  readonly stages: readonly LoadingStage[];
}

export interface LoadingOperation {
  addReceivedBytes(bytes: number): void;
  recordCache(outcome: "hit" | "miss" | "in-flight"): void;
  /** Idempotent. Late completions cannot mutate a sealed or replacement run. */
  finish(outcome?: LoadingOutcome): void;
}

export interface LoadingRun {
  startStage(name: string): LoadingOperation;
  /** Preserves the return value/error; promise settlement remains bound to this run. */
  measure<T>(name: string, work: () => T): T;
  finish(outcome: LoadingOutcome): void;
}

export interface LoadingProfiler {
  /** Replacing a current run seals it as cancelled; old handles stay bound to that run. */
  beginRun(options: { readonly label: string; readonly kind: LoadingSnapshot["kind"] }): LoadingRun;
  snapshot(): LoadingSnapshot | null;
  history(): readonly LoadingSnapshot[];
  /** First successful fresh-context run; retained independently of bounded history. */
  baseline(): LoadingSnapshot | null;
  /** Invalidates handles and clears history/baseline without recycling run IDs. */
  clear(): void;
  dispose(): void;
}

export interface LoadingOptions {
  readonly now?: () => number;
  /** Defaults: 8 retained runs, 128 distinct stages and 4096 operations per run. */
  readonly historyCapacity?: number;
  readonly maxStages?: number;
  readonly maxOperations?: number;
}

export type CreateLoadingProfiler = (options?: LoadingOptions) => LoadingProfiler;
