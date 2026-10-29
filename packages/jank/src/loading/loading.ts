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
  finish(outcome: LoadingOutcome): void;
}

export interface LoadingProfiler {
  /** Replacing a current run seals it as cancelled; old handles stay bound to that run. */
  beginRun(options: { readonly label: string; readonly kind: LoadingSnapshot["kind"] }): LoadingRun;
  snapshot(): LoadingSnapshot | null;
  history(): readonly LoadingSnapshot[];
  dispose(): void;
}

export type CreateLoadingProfiler = (options?: { readonly now?: () => number }) => LoadingProfiler;
