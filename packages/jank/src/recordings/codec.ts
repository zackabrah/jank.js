import { collectionLimits } from "../core/limits.ts";
import { checkJsonSize, parseJsonData } from "./json.ts";
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

export function readRecording(value: unknown): Recording {
  const data = object(value, "$");
  if (data.schemaVersion !== 5) {
    throw new RecordingError({
      code: "unsupported-version",
      path: "$.schemaVersion",
      message: "Expected recording schema version 5; older files require their matching preview",
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
    schemaVersion: 5,
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
  const parsed = parseJsonData(json, readRecording);
  return parsed.ok ? { ok: true, recording: parsed.value } : parsed;
}

export function serializeRecording(recording: Recording): string {
  const json = JSON.stringify(readRecording(recording));
  checkJsonSize(json);
  return json;
}
