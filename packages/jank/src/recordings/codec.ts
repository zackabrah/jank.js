import { collectionLimits } from "../core/limits.ts";
import { recordingLimits } from "./limits.ts";
import { readFrames } from "./read-frames.ts";
import { readCapture, readMetadata } from "./read-metadata.ts";
import { readCounters, readEvents, readGpu } from "./read-observations.ts";
import {
  boolean,
  choice,
  invalid,
  list,
  number,
  object,
  RecordingError,
  text,
} from "./read-values.ts";
import type { Recording, RecordingResult } from "./recording.ts";

function checkSize(json: string): void {
  let bytes = 0;
  for (const character of json) {
    const point = character.charCodeAt(0);
    if (character.length === 2) {
      bytes += 4;
    } else if (point <= 0x7f) {
      bytes += 1;
    } else if (point <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > recordingLimits.fileBytes) {
      throw new RecordingError({
        code: "too-large",
        path: "$",
        message: "Recording exceeds 32 MiB of UTF-8",
      });
    }
  }
}

export function readRecording(value: unknown): Recording {
  const data = object(value, "$");
  if (data.schemaVersion !== 4) {
    throw new RecordingError({
      code: "unsupported-version",
      path: "$.schemaVersion",
      message: "Expected recording schema version 4; older files require their matching preview",
    });
  }
  const clock = object(data.clock, "$.clock");
  const channelIds = new Set<string>();
  const channels = list(data.channels, "$.channels", collectionLimits.channels, (value, path) => {
    const channel = object(value, path);
    const id = text(channel.id, `${path}.id`);
    if (channelIds.has(id)) {
      invalid(`${path}.id`, "Duplicate channel ID");
    }
    channelIds.add(id);
    return { id, label: text(channel.label, `${path}.label`) };
  });
  const frames = readFrames(data.frames, channelIds);
  const truncated = boolean(data.truncated, "$.truncated");
  return {
    format: choice(data.format, "$.format", ["jank.js-recording"]),
    schemaVersion: 4,
    clock: {
      unit: choice(clock.unit, "$.clock.unit", ["milliseconds"]),
      origin: choice(clock.origin, "$.clock.origin", ["profiler-start"]),
    },
    metadata: readMetadata(data.metadata),
    targetFps: number(data.targetFps, "$.targetFps", Number.MIN_VALUE),
    capture: readCapture(data.capture, frames, truncated),
    truncated,
    channels,
    frames,
    counters: readCounters(data.counters, frames, channelIds),
    events: readEvents(data.events, frames),
    gpu: readGpu(data.gpu, frames),
  };
}

export function parseRecording(json: string): RecordingResult {
  try {
    checkSize(json);
    const value: unknown = JSON.parse(json);
    return { ok: true, recording: readRecording(value) };
  } catch (error) {
    if (error instanceof RecordingError) {
      return { ok: false, problem: error.problem };
    }
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        problem: { code: "invalid-json", path: "$", message: "File is not valid JSON" },
      };
    }
    throw error;
  }
}

export function serializeRecording(recording: Recording): string {
  const json = JSON.stringify(readRecording(recording));
  checkSize(json);
  return json;
}
