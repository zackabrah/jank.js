import type { LoadingOptions, LoadingProfiler, LoadingSnapshot } from "./loading.ts";
import { copyLoading, LoadingRunState, loadingLabel } from "./run.ts";

export function createLoadingProfilerRuntime(
  options: LoadingOptions & { readonly now: () => number },
): LoadingProfiler {
  const historyCapacity = capacity(options.historyCapacity ?? 8);
  const maxStages = capacity(options.maxStages ?? 128);
  const maxOperations = capacity(options.maxOperations ?? 4096);
  let current: LoadingRunState | null = null;
  let baseline: LoadingSnapshot | null = null;
  const history: LoadingSnapshot[] = [];
  let nextId = 1;
  let disposed = false;
  let lastAtMs = -Infinity;
  function now(): number {
    const atMs = options.now();
    if (!Number.isFinite(atMs) || atMs < lastAtMs) {
      throw new RangeError("Loading clock must be finite and monotonic");
    }
    lastAtMs = atMs;
    return atMs;
  }
  function clear(): void {
    current?.invalidate();
    current = null;
    history.length = 0;
    baseline = null;
  }
  return {
    beginRun: (configuration) => {
      if (disposed) {
        throw new Error("Loading profiler is disposed");
      }
      loadingLabel(configuration.label, "label");
      if (!["fresh-context", "repeat-session", "editor"].includes(configuration.kind)) {
        throw new RangeError("Unknown loading run kind");
      }
      const startedAtMs = now();
      current?.finish("cancelled");
      current = new LoadingRunState({
        ...configuration,
        id: nextId++,
        startedAtMs,
        now,
        maxStages,
        maxOperations,
        onFinish: (snapshot) => {
          history.push(snapshot);
          if (history.length > historyCapacity) {
            history.shift();
          }
          if (
            !baseline &&
            snapshot.kind === "fresh-context" &&
            snapshot.status === "ready" &&
            snapshot.pendingOperations === 0
          ) {
            baseline = snapshot;
          }
        },
      });
      return current;
    },
    snapshot: () => current?.snapshot(now()) ?? null,
    history: () => history.map(copyLoading),
    baseline: () => (baseline ? copyLoading(baseline) : null),
    clear,
    dispose: () => {
      clear();
      disposed = true;
    },
  };
}
function capacity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Loading capacity must be a positive integer");
  }
  return value;
}
