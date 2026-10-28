import type { GpuProfile } from "../types/gpu-profile-types.ts";

import { maxTimerReads, unknownEnvironment } from "./environment.ts";

import type {
  CaptureStatus,
  DiagnosticFrame,
  DiagnosticOverhead,
  DiagnosticSystem,
  DiagnosticValues,
  PerformanceRecording,
  RecordingMetadata,
} from "./recording-types.ts";

const bytesPerKibibyte = 1024;

const maxRecordingMebibytes = 32;

export const MAX_RECORDING_BYTES =
  maxRecordingMebibytes * bytesPerKibibyte * bytesPerKibibyte;

const recordingFormat = "jank.js-recording";

/** The legacy engine export, read as version 1. */
const legacyFormat = "world-performance-recording";

const milliseconds = "milliseconds";

export const msPerSecond = 1000;

export const defaultTargetFps = 60;

export const maxTargetFps = 1000;

// Frame coverage values the panel and viewer test for.
export const completeCoverage = "complete";

export const unavailableCoverage = "unavailable";

// The capture mode of a recording AUTO CAPTURE made.
export const automaticCapture = "automatic";

/** Float slack for scope bounds and the stored frame budget. */
const toleranceMs = 0.000001;

// Format limits shared with the diagnostics writer, which never exceeds them.
export const maxLabelLength = 240;

export const maxDetailLength = 2000;

export const maxSystems = 64;

export const maxSystemValues = 64;

export const maxScopesPerFrame = 1024;

export const recordingFrameCapacity = 6000;

export const overheadFrames = 600;

export const maxBeforeFrames = 599;

export const maxAfterFrames = 5400;

export const maxSamples = 1200;

export const maxEvents = 200;

const maxGpuPasses = 256;

export class RecordingFormatError extends Error {
  override name = "RecordingFormatError";
}

/** Rejects an imported recording, naming the field that failed validation. */
const fail = (path: string): never => {
  throw new RecordingFormatError(`Invalid recording: ${path}`);
};

/** Validates a plain object and copies its own entries. */
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(path);

  return Object.fromEntries(Object.entries(value));
}

/** Validates an array no longer than the limit. */
function array(value: unknown, path: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    return fail(`${path} (maximum ${limit} entries)`);

  return value;
}

/** Validates a finite number within the range. */
function number(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_VALUE,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    return fail(path);

  return value;
}

/** Validates a whole number within the range. */
function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const result = number(value, path, minimum, maximum);

  if (!Number.isSafeInteger(result)) return fail(path);

  return result;
}

/** Validates a string no longer than the limit. */
function string(value: unknown, path: string, limit = maxLabelLength): string {
  if (typeof value !== "string" || value.length > limit) return fail(path);

  return value;
}

/** Validates a boolean. */
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path);

  return value;
}

/** Validates a value as one of the allowed strings. */
function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  for (const item of allowed) if (item === value) return item;

  return fail(path);
}

/** Validates a number or null. */
function nullableNumber(value: unknown, path: string) {
  return value === null ? null : number(value, path);
}

/** Validates a detail-length string or null. */
function nullableString(value: unknown, path: string) {
  return value === null ? null : string(value, path, maxDetailLength);
}

/** Validates the instrumented systems and their counter values. */
function systems(value: unknown): DiagnosticSystem[] {
  return array(value, "systems", maxSystems).map((entry) => {
    const row = object(entry, "system"),
      counters = object(row["values"], "system.values");

    if (Object.keys(counters).length > maxSystemValues) fail("system.values");

    const values: DiagnosticValues = Object.fromEntries(
      Object.entries(counters).map(([key, item]) => {
        string(key, "counter name");

        if (item === null || typeof item === "boolean") return [key, item];

        if (typeof item === "number")
          return [key, number(item, key, -Number.MAX_VALUE)];

        return [key, string(item, key, maxDetailLength)];
      }),
    );

    return {
      id: string(row["id"], "system.id"),
      label: string(row["label"], "system.label"),
      cpu: number(row["cpu"], "system.cpu"),
      peak: number(row["peak"], "system.peak"),
      values,
    };
  });
}

/** Validates the monitor's own collection and refresh costs. */
function overhead(value: unknown): DiagnosticOverhead {
  const data = object(value, "overhead");

  /** Validates one cost's last, mean and peak. */
  const cost = (key: string) => {
    const item = object(data[key], `overhead.${key}`);

    return {
      last: number(item["last"], key),
      mean: number(item["mean"], key),
      peak: number(item["peak"], key),
    };
  };

  return {
    collection: cost("collection"),
    refresh: cost("refresh"),
    frames: integer(data["frames"], "overhead.frames", 0, overheadFrames),
    measurement:
      "Synchronous instrumentation and UI refresh; excludes deferred browser layout, paint and GPU work",
  };
}

/** Validates the environment and application metadata. */
function metadata(value: unknown): RecordingMetadata {
  const data = object(value, "metadata"),
    env = object(data["environment"], "environment"),
    cpu = object(env["cpuTimer"], "cpuTimer"),
    gpu = object(env["gpuTimer"], "gpuTimer");

  const viewport =
    env["viewport"] === null ? null : object(env["viewport"], "viewport");

  const application =
    data["application"] === null
      ? null
      : object(data["application"], "application");

  return {
    jankVersion: nullableString(data["jankVersion"], "jankVersion"),
    application: application
      ? {
          name: string(application["name"], "application.name"),
          version: nullableString(
            application["version"],
            "application.version",
          ),
        }
      : null,
    createdAt: nullableString(data["createdAt"], "createdAt"),
    devTools: bool(data["devTools"], "devTools"),
    importedFromVersion:
      data["importedFromVersion"] === null
        ? null
        : integer(data["importedFromVersion"], "importedFromVersion", 1, 2),
    environment: {
      userAgent: nullableString(env["userAgent"], "userAgent"),
      platform: nullableString(env["platform"], "platform"),
      hardwareConcurrency: nullableNumber(
        env["hardwareConcurrency"],
        "hardwareConcurrency",
      ),
      crossOriginIsolated:
        env["crossOriginIsolated"] === null
          ? null
          : bool(env["crossOriginIsolated"], "crossOriginIsolated"),
      viewport: viewport
        ? {
            width: number(viewport["width"], "viewport.width"),
            height: number(viewport["height"], "viewport.height"),
            pixelRatio: number(viewport["pixelRatio"], "viewport.pixelRatio"),
          }
        : null,
      cpuTimer: {
        source: choice(
          cpu["source"],
          ["performance.now", "custom", "unknown"],
          "cpuTimer.source",
        ),
        estimatedResolutionMs: nullableNumber(
          cpu["estimatedResolutionMs"],
          "cpuTimer.resolution",
        ),
        method: choice(
          cpu["method"],
          ["minimum-observed-positive-delta", "unavailable"],
          "cpuTimer.method",
        ),
        reads: integer(cpu["reads"], "cpuTimer.reads", 0, maxTimerReads),
      },
      gpuTimer: {
        source: choice(gpu["source"], ["host", "unknown"], "gpuTimer.source"),
        estimatedResolutionMs: nullableNumber(
          gpu["estimatedResolutionMs"],
          "gpuTimer.resolution",
        ),
      },
    },
  };
}

/** Validates the capture mode, window and progress. */
function capture(value: unknown): CaptureStatus {
  const data = object(value, "capture");

  return {
    mode: choice(
      data["mode"],
      ["manual", "automatic", "recent"],
      "capture.mode",
    ),
    state: choice(
      data["state"],
      ["idle", "armed", "recording", "cooldown"],
      "capture.state",
    ),
    triggerFrame:
      data["triggerFrame"] === null
        ? null
        : integer(data["triggerFrame"], "triggerFrame"),
    thresholdMs: nullableNumber(data["thresholdMs"], "thresholdMs"),
    beforeFrames: integer(
      data["beforeFrames"],
      "beforeFrames",
      0,
      maxBeforeFrames,
    ),
    afterFrames: integer(data["afterFrames"], "afterFrames", 0, maxAfterFrames),
    cooldownMs: number(data["cooldownMs"], "cooldownMs"),
    remainingFrames: integer(
      data["remainingFrames"],
      "remainingFrames",
      0,
      maxAfterFrames,
    ),
  };
}

/** Validates the GPU profile and its passes. */
function gpuProfile(value: unknown): GpuProfile {
  const data = object(value, "gpu profile");

  /** Validates a frame id that may be null. */
  const nullableFrame = (key: string) =>
    data[key] === null ? null : integer(data[key], `gpu.${key}`);

  return {
    available: bool(data["available"], "gpu.available"),
    enabled: bool(data["enabled"], "gpu.enabled"),
    status: choice(
      data["status"],
      ["ready", "unsupported", "disabled", "pending", "error"],
      "gpu.status",
    ),
    currentFrame: nullableFrame("currentFrame"),
    sampleFrame: nullableFrame("sampleFrame"),
    sampleAgeFrames: nullableFrame("sampleAgeFrames"),
    gpuMilliseconds: nullableNumber(data["gpuMilliseconds"], "gpuMilliseconds"),
    passes: array(data["passes"], "gpu.passes", maxGpuPasses).map((item) => {
      const pass = object(item, "gpu pass");

      return {
        label: string(pass["label"], "pass.label"),
        milliseconds: nullableNumber(pass["milliseconds"], "pass.milliseconds"),
      };
    }),
    droppedFrames: integer(data["droppedFrames"], "droppedFrames"),
    truncatedPasses: integer(data["truncatedPasses"], "truncatedPasses"),
    error: nullableString(data["error"], "gpu.error"),
    ...(data["diagnosticFrame"] === undefined
      ? {}
      : { diagnosticFrame: nullableFrame("diagnosticFrame") }),
  };
}

/** Validate and copy untrusted JSON. Unknown extension fields are intentionally ignored. */
export function parseRecording(text: string): PerformanceRecording {
  if (
    text.length > MAX_RECORDING_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_RECORDING_BYTES
  )
    throw new RecordingFormatError("Recording exceeds the 32 MiB import limit");

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecordingFormatError("Recording is not valid JSON");
  }

  const data = object(parsed, "root");

  if (data["format"] !== recordingFormat && data["format"] !== legacyFormat)
    fail("format");

  const version = integer(data["version"], "version", 1, 2);

  // Version 1 is the legacy engine export; jank.js writes only version 2.
  if ((version === 2) !== (data["format"] === recordingFormat))
    fail("format/version");

  if (data["units"] !== milliseconds) fail("units");

  let previousAt = -Infinity;

  const ids = new Set<number>();

  const frames: DiagnosticFrame[] = array(
    data["frames"],
    "frames",
    recordingFrameCapacity,
  ).map((item, index) => {
    const frame = object(item, "frame"),
      at = number(frame["at"], "frame.at", -Number.MAX_VALUE),
      interval = number(frame["interval"], "frame.interval", Number.MIN_VALUE);

    const id = version === 1 ? index + 1 : integer(frame["id"], "frame.id", 1);

    if (ids.has(id) || at < previousAt) fail("frame ordering/IDs");

    ids.add(id);

    previousAt = at;

    const scopes =
      version === 1
        ? []
        : array(frame["scopes"], "frame.scopes", maxScopesPerFrame).map(
            (entry) => {
              const scope = object(entry, "scope"),
                start = number(
                  scope["start"],
                  "scope.start",
                  at - interval - toleranceMs,
                  at + toleranceMs,
                ),
                end = number(
                  scope["end"],
                  "scope.end",
                  start,
                  at + toleranceMs,
                );

              return {
                system: string(scope["system"], "scope.system"),
                label: string(scope["label"], "scope.label"),
                start,
                end,
              };
            },
          );

    const cost =
      version === 1 ? null : object(frame["overhead"], "frame.overhead");

    return {
      id,
      at,
      interval,
      update: number(frame["update"], "frame.update"),
      render: number(frame["render"], "frame.render"),
      scopes,
      coverage:
        version === 1
          ? "unavailable"
          : choice(
              frame["coverage"],
              ["complete", "truncated", "unavailable"],
              "frame.coverage",
            ),
      droppedScopes:
        version === 1 ? 0 : integer(frame["droppedScopes"], "droppedScopes"),
      overhead: {
        collectionMs: cost ? number(cost["collectionMs"], "collectionMs") : 0,
        refreshMs: cost ? number(cost["refreshMs"], "refreshMs") : 0,
      },
    };
  });

  const budget = version === 1 ? null : object(data["budget"], "budget");

  const targetFps = budget
    ? number(budget["targetFps"], "targetFps", 1, maxTargetFps)
    : defaultTargetFps;

  if (
    budget &&
    Math.abs(number(budget["frameMs"], "frameMs") - msPerSecond / targetFps) >
      toleranceMs
  )
    fail("inconsistent frame budget");

  const result: PerformanceRecording = {
    format: "jank.js-recording",
    version: 2,
    units: "milliseconds",
    frameCapacity: integer(
      data["frameCapacity"],
      "frameCapacity",
      1,
      recordingFrameCapacity,
    ),
    frames,
    metadata:
      version === 1
        ? {
            jankVersion: null,
            application: null,
            createdAt: null,
            environment: unknownEnvironment(),
            devTools: false,
            importedFromVersion: 1,
          }
        : metadata(data["metadata"]),
    budget: { targetFps, frameMs: msPerSecond / targetFps },
    capture:
      version === 1
        ? {
            mode: "recent",
            state: "idle",
            triggerFrame: null,
            thresholdMs: null,
            beforeFrames: 0,
            afterFrames: 0,
            cooldownMs: 0,
            remainingFrames: 0,
          }
        : capture(data["capture"]),
    overhead:
      version === 1
        ? {
            collection: { last: 0, mean: 0, peak: 0 },
            refresh: { last: 0, mean: 0, peak: 0 },
            frames: 0,
            measurement:
              "Synchronous instrumentation and UI refresh; excludes deferred browser layout, paint and GPU work",
          }
        : overhead(data["overhead"]),
    systems: systems(data["systems"]),
    samples: array(data["samples"], "samples", maxSamples)
      .map((item) => {
        const sample = object(item, "sample");

        return {
          at: number(sample["at"], "sample.at", -Number.MAX_VALUE),
          systems: systems(sample["systems"]),
        };
      })
      .toSorted((a, b) => a.at - b.at),
    events: array(data["events"], "events", maxEvents).map((item) => {
      const event = object(item, "event");

      return {
        at: number(event["at"], "event.at", -Number.MAX_VALUE),
        label: string(event["label"], "event.label"),
        detail: string(event["detail"], "event.detail", maxDetailLength),
      };
    }),
  };

  if (data["gpu"] !== undefined) {
    const gpu = object(data["gpu"], "gpu");

    if (gpu["units"] !== milliseconds) fail("gpu.units");

    result.gpu = {
      units: "milliseconds",
      measurement: string(
        gpu["measurement"],
        "gpu.measurement",
        maxDetailLength,
      ),
      latest: gpu["latest"] === null ? null : gpuProfile(gpu["latest"]),
      samples: array(gpu["samples"], "gpu.samples", recordingFrameCapacity).map(
        gpuProfile,
      ),
    };
  }

  return result;
}

/** Serializes a recording, validating it with the import parser first so exports always re-import. */
export function serializeRecording(recording: PerformanceRecording): string {
  const text = JSON.stringify(recording);

  parseRecording(text);

  return text;
}
