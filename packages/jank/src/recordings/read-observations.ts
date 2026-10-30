import type { CounterSample, CounterValue, EventSample, FrameSample } from "../core/frames.ts";
import type { GpuSample } from "../core/gpu.ts";
import { collectionLimits } from "../core/limits.ts";
import { recordingLimits } from "./limits.ts";
import { readGpuIntervals } from "./read-gpu-intervals.ts";
import {
  choice,
  integer,
  invalid,
  list,
  nullable,
  number,
  object,
  reference,
  text,
} from "./read-values.ts";

export function readCounterValues(
  value: unknown,
  path: string,
): Readonly<Record<string, CounterValue>> {
  const entries = Object.entries(object(value, path));
  if (entries.length > recordingLimits.counterValues) {
    invalid(path, "Too many counter values");
  }
  return Object.fromEntries(
    entries.map(([key, value]) => {
      text(key, `${path}.${key}`);
      if (value === null || typeof value === "boolean") {
        return [key, value];
      }
      if (typeof value === "string") {
        if (value.length > collectionLimits.labelLength) {
          invalid(`${path}.${key}`, "Counter text exceeds the label limit");
        }
        return [key, value];
      }
      return [key, number(value, `${path}.${key}`, -Number.MAX_VALUE)];
    }),
  );
}

function sampleTime(value: unknown, path: string, frames: readonly FrameSample[]): number {
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) {
    return invalid(path, "A timestamped sample needs recorded frames");
  }
  return number(value, path, first.startedAtMs, last.endedAtMs);
}

export function readCounters(
  value: unknown,
  frames: readonly FrameSample[],
  channelIds: ReadonlySet<string>,
): CounterSample[] {
  return list(value, "$.counters", recordingLimits.counters, (entry, path) => {
    const data = object(entry, path);
    const base = {
      atMs: sampleTime(data.atMs, `${path}.atMs`, frames),
      channelId: reference(data.channelId, `${path}.channelId`, channelIds),
    };
    const status = choice(data.status, `${path}.status`, ["ready", "error"]);
    return status === "ready"
      ? { ...base, status, values: readCounterValues(data.values, `${path}.values`) }
      : {
          ...base,
          status,
          message: text(data.message, `${path}.message`, recordingLimits.detailLength),
        };
  });
}

export function readEvents(value: unknown, frames: readonly FrameSample[]): EventSample[] {
  return list(value, "$.events", recordingLimits.events, (entry, path) => {
    const data = object(entry, path);
    return {
      atMs: sampleTime(data.atMs, `${path}.atMs`, frames),
      label: text(data.label, `${path}.label`),
      detail: nullable(data.detail, `${path}.detail`, (value, path) =>
        text(value, path, recordingLimits.detailLength),
      ),
    };
  });
}

export function readGpuSample(value: unknown, path: string): GpuSample {
  const data = object(value, path);
  if (data.measurement === "intervals") {
    return readGpuIntervals(value, path);
  }
  return {
    frameId: nullable(data.frameId, `${path}.frameId`, (value, path) => integer(value, path, 1)),
    rendererFrameId: integer(data.rendererFrameId, `${path}.rendererFrameId`),
    measurement: choice(data.measurement, `${path}.measurement`, ["pass-sum", "elapsed-span"]),
    durationMs: nullable(data.durationMs, `${path}.durationMs`, number),
    omittedPasses: integer(data.omittedPasses, `${path}.omittedPasses`),
    passes: list(data.passes, `${path}.passes`, recordingLimits.gpuPasses, (entry, path) => {
      const pass = object(entry, path);
      return {
        label: text(pass.label, `${path}.label`),
        durationMs: nullable(pass.durationMs, `${path}.durationMs`, number),
      };
    }),
  };
}

export function readGpu(value: unknown, frames: readonly FrameSample[]): GpuSample[] {
  const frameIds = new Set(frames.map((frame) => frame.id));
  let passCount = 0;
  const identities = new Set<string>();
  return list(value, "$.gpu", recordingLimits.frames, (entry, path) => {
    const sample = readGpuSample(entry, path);
    passCount += sample.passes.length;
    if (passCount > recordingLimits.gpuIntervals) {
      invalid(path, "Recording exceeds the total GPU pass limit");
    }
    if (sample.measurement === "intervals") {
      const key = `${sample.clock.id}:${sample.sequence}`;
      if (identities.has(key)) {
        invalid(path, "Duplicate GPU frame sequence for this clock");
      }
      identities.add(key);
    }
    if (sample.frameId !== null && !frameIds.has(sample.frameId)) {
      invalid(`${path}.frameId`, "Unknown frame ID");
    }
    return sample;
  });
}
