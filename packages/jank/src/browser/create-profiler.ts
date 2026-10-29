import manifest from "../../package.json" with { type: "json" };
import { createProfilerRuntime, type Profiler, type ProfilerOptions } from "../profiler.ts";
import { readMetadata } from "../recordings/read-metadata.ts";
import type { RecordingEnvironment } from "../recordings/recording.ts";

/** Environment defaults are resolved here; the measurement and recording owners stay portable. */
export function createProfiler(options: ProfilerOptions = {}): Profiler {
  const now = options.now ?? (() => performance.now());
  const environment: RecordingEnvironment = {
    userAgent: typeof navigator === "undefined" ? null : navigator.userAgent || null,
    platform: typeof navigator === "undefined" ? null : navigator.platform || null,
    hardwareConcurrency:
      typeof navigator === "undefined" ? null : navigator.hardwareConcurrency || null,
    crossOriginIsolated: typeof crossOriginIsolated === "undefined" ? null : crossOriginIsolated,
    viewport:
      typeof window === "undefined"
        ? null
        : {
            widthPx: window.innerWidth,
            heightPx: window.innerHeight,
            pixelRatio: window.devicePixelRatio,
          },
    timer: { source: options.now ? "custom" : "performance.now", estimatedResolutionMs: null },
  };
  const metadata = readMetadata({
    createdAt: new Date().toISOString(),
    toolVersion: manifest.version,
    application: options.application
      ? { name: options.application.name, version: options.application.version ?? null }
      : null,
    environment,
  });
  return createProfilerRuntime(
    { ...options, now },
    {
      costNow: () => performance.now(),
      metadata: () => ({ ...metadata, createdAt: new Date().toISOString() }),
    },
  );
}
