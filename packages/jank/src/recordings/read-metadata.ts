import type { FrameSample } from "../core/frames.ts";
import { recordingLimits } from "./limits.ts";
import {
  boolean,
  choice,
  integer,
  invalid,
  nullable,
  number,
  object,
  text,
} from "./read-values.ts";
import type { Recording, RecordingEnvironment } from "./recording.ts";

function environment(value: unknown, path: string): RecordingEnvironment {
  const data = object(value, path);
  const timer = object(data.timer, `${path}.timer`);
  return {
    userAgent: nullable(data.userAgent, `${path}.userAgent`, (value, path) =>
      text(value, path, recordingLimits.detailLength),
    ),
    platform: nullable(data.platform, `${path}.platform`, text),
    hardwareConcurrency: nullable(
      data.hardwareConcurrency,
      `${path}.hardwareConcurrency`,
      (value, path) => integer(value, path, 1),
    ),
    crossOriginIsolated: nullable(data.crossOriginIsolated, `${path}.crossOriginIsolated`, boolean),
    viewport: nullable(data.viewport, `${path}.viewport`, (value, path) => {
      const viewport = object(value, path);
      return {
        widthPx: number(viewport.widthPx, `${path}.widthPx`),
        heightPx: number(viewport.heightPx, `${path}.heightPx`),
        pixelRatio: number(viewport.pixelRatio, `${path}.pixelRatio`, Number.MIN_VALUE),
      };
    }),
    timer: {
      source: choice(timer.source, `${path}.timer.source`, ["performance.now", "custom"]),
      estimatedResolutionMs: nullable(
        timer.estimatedResolutionMs,
        `${path}.timer.estimatedResolutionMs`,
        number,
      ),
    },
  };
}

export function readMetadata(value: unknown): Recording["metadata"] {
  const path = "$.metadata";
  const data = object(value, path);
  const createdAt = text(data.createdAt, `${path}.createdAt`);
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== createdAt) {
    invalid(`${path}.createdAt`, "Expected a canonical ISO UTC timestamp");
  }
  return {
    createdAt,
    toolVersion: text(data.toolVersion, `${path}.toolVersion`),
    environment: environment(data.environment, `${path}.environment`),
    application: nullable(data.application, `${path}.application`, (value, path) => {
      const application = object(value, path);
      return {
        name: text(application.name, `${path}.name`),
        version: nullable(application.version, `${path}.version`, text),
      };
    }),
  };
}

export function readCapture(
  value: unknown,
  frames: readonly FrameSample[],
  truncated: boolean,
): Recording["capture"] {
  const path = "$.capture";
  const data = object(value, path);
  const kind = choice(data.kind, `${path}.kind`, ["manual", "recent", "automatic"]);
  if (kind !== "automatic") {
    return { kind };
  }
  const triggerFrameId = integer(data.triggerFrameId, `${path}.triggerFrameId`, 1);
  const triggerIndex = frames.findIndex((frame) => frame.id === triggerFrameId);
  const trigger = frames[triggerIndex];
  if (!trigger) {
    invalid(`${path}.triggerFrameId`, "Trigger frame is missing");
  }
  const thresholdMs = number(data.thresholdMs, `${path}.thresholdMs`, Number.MIN_VALUE);
  if (trigger.endedAtMs - trigger.startedAtMs <= thresholdMs) {
    invalid(`${path}.thresholdMs`, "Trigger frame must exceed the threshold");
  }
  const beforeFrames = integer(
    data.beforeFrames,
    `${path}.beforeFrames`,
    0,
    recordingLimits.beforeFrames,
  );
  const afterFrames = integer(
    data.afterFrames,
    `${path}.afterFrames`,
    0,
    recordingLimits.afterFrames,
  );
  checkWindow(`${path}.beforeFrames`, beforeFrames, triggerIndex, truncated);
  checkWindow(`${path}.afterFrames`, afterFrames, frames.length - triggerIndex - 1, truncated);
  return { kind, triggerFrameId, thresholdMs, beforeFrames, afterFrames };
}

function checkWindow(path: string, requested: number, recorded: number, truncated: boolean): void {
  if (recorded > requested || (!truncated && recorded !== requested)) {
    invalid(path, "Frame count does not match the requested capture window");
  }
}
