import type { LoadingOptions, LoadingProfiler } from "../loading/loading.ts";
import { createLoadingProfilerRuntime } from "../loading/profiler.ts";

export function createLoadingProfiler(options: LoadingOptions = {}): LoadingProfiler {
  return createLoadingProfilerRuntime({
    ...options,
    now: options.now ?? (() => performance.now()),
  });
}
