import { buildInfo } from "./build-info.ts";

import type {
  RecordingEnvironment,
  RecordingMetadata,
} from "./recording-types.ts";

export const maxTimerReads = 4096;

/** Bounded observation, not a promise of the browser's true timer precision. */
export function estimateTimerResolution(
  now: () => number,
  reads = 256,
): RecordingEnvironment["cpuTimer"] {
  const count = Math.min(maxTimerReads, Math.max(2, Math.floor(reads)));

  let previous = now(),
    minimum = Infinity;

  for (let i = 1; i < count; i++) {
    const current = now(),
      delta = current - previous;

    if (Number.isFinite(delta) && delta > 0) minimum = Math.min(minimum, delta);

    previous = current;
  }

  return {
    source: "performance.now",
    estimatedResolutionMs: Number.isFinite(minimum) ? minimum : null,
    method: Number.isFinite(minimum)
      ? "minimum-observed-positive-delta"
      : "unavailable",
    reads: count,
  };
}

/** An environment with every field null, for hosts and imports that report nothing. */
export function unknownEnvironment(): RecordingEnvironment {
  return {
    userAgent: null,
    platform: null,
    hardwareConcurrency: null,
    viewport: null,
    crossOriginIsolated: null,
    cpuTimer: {
      source: "unknown",
      estimatedResolutionMs: null,
      method: "unavailable",
      reads: 0,
    },
    gpuTimer: { source: "unknown", estimatedResolutionMs: null },
  };
}

/** Captures the version, browser, timer and application details stored with a recording. */
export function recordingMetadata(
  timer: RecordingEnvironment["cpuTimer"],
  application: RecordingMetadata["application"],
  devTools: boolean,
): RecordingMetadata {
  const browser =
    typeof window !== "undefined" && typeof navigator !== "undefined";

  return {
    jankVersion: buildInfo.version,
    application: application ? { ...application } : null,
    createdAt: new Date().toISOString(),
    devTools,
    importedFromVersion: null,
    environment: {
      ...unknownEnvironment(),
      userAgent: browser ? navigator.userAgent : null,
      platform: browser ? navigator.platform : null,
      hardwareConcurrency: browser ? navigator.hardwareConcurrency : null,
      crossOriginIsolated:
        typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : null,
      viewport: browser
        ? {
            width: innerWidth,
            height: innerHeight,
            pixelRatio: devicePixelRatio,
          }
        : null,
      cpuTimer: { ...timer },
    },
  };
}
