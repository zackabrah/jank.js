import {
  type GpuFrameResolution,
  type GpuFrameResolver,
  type GpuSample,
  gpuPassStorage,
} from "../core/gpu.ts";
import { readRecording } from "../recordings/codec.ts";
import { recordingLimits } from "../recordings/limits.ts";
import { describeError } from "../recordings/observations.ts";
import { readGpuSample } from "../recordings/read-observations.ts";
import { choice, invalid } from "../recordings/read-values.ts";
import type { Recording } from "../recordings/recording.ts";

export interface RecordingFinalization {
  readonly coverage: GpuCoverage;
  readonly recording: Recording;
  readonly status: GpuFrameResolution["status"] | "error";
  /** Every recorded CPU frame has complete interval data, and no merge samples were omitted. */
  readonly complete: boolean;
  readonly missingFrameIds: readonly number[];
  readonly incompleteFrameIds: readonly number[];
  readonly omittedSamples: number;
  readonly error: string | null;
}

/** Call after capture.stop(), outside the host frame callback. Returns a new, detached capture. */
export async function finalizeRecording(
  recording: Recording,
  source: GpuFrameResolver,
  options: { readonly timeoutMs?: number } = {},
): Promise<RecordingFinalization> {
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 10_000) {
    throw new RangeError("timeoutMs must be an integer from 0 to 10000");
  }
  // Detach before awaiting: the host may continue collecting or mutate its own copy.
  const stopped = readRecording(recording);
  const frameIds = stopped.frames.map((frame) => frame.id);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const resolution = await Promise.race([
      Promise.resolve().then(() => source.resolveFrames(frameIds, { timeoutMs })),
      new Promise<GpuFrameResolution>((resolve) => {
        timeout = setTimeout(
          () => resolve({ status: "timeout", samples: [], pendingFrameIds: [] }),
          timeoutMs,
        );
      }),
    ]);
    const status = choice(resolution.status, "$.resolution.status", [
      "settled",
      "timeout",
      "cancelled",
      "unavailable",
    ]);
    const merged = mergeSamples(stopped, resolution.samples);
    return describeFinalization(merged.recording, status, merged.omittedSamples, null);
  } catch (cause) {
    return describeFinalization(stopped, "error", 0, describeError(cause));
  } finally {
    clearTimeout(timeout);
  }
}

function sampleKey(sample: GpuSample): string {
  return sample.measurement === "intervals"
    ? `interval:${sample.clock.id}:${sample.sequence}`
    : `duration:${sample.rendererFrameId}:${sample.frameId}`;
}

/** Preserve existing observations first; fill remaining bounded capacity with late results. */
function mergeSamples(recording: Recording, incoming: GpuFrameResolution["samples"]) {
  const frameIds = new Set(recording.frames.map((frame) => frame.id));
  const samples = new Map(
    recording.gpu.map((sample, index) => [
      sample.measurement === "intervals" ? sampleKey(sample) : `${sampleKey(sample)}:${index}`,
      sample,
    ]),
  );
  let passCount = recording.gpu.reduce((sum, sample) => sum + gpuPassStorage(sample), 0);
  let omittedSamples = 0;
  for (const sample of readResolutionSamples(incoming)) {
    const key = sampleKey(sample);
    if (sample.frameId === null || !frameIds.has(sample.frameId)) {
      continue;
    }
    const previous = samples.get(key);
    if (previous?.measurement === "intervals" && previous.completeness === "complete") {
      continue;
    }
    const nextPassCount =
      passCount + gpuPassStorage(sample) - (previous ? gpuPassStorage(previous) : 0);
    if (
      nextPassCount > recordingLimits.gpuIntervals ||
      (!previous && samples.size === recordingLimits.frames)
    ) {
      omittedSamples += 1;
      continue;
    }
    samples.set(key, sample);
    passCount = nextPassCount;
  }
  return { recording: { ...recording, gpu: [...samples.values()] }, omittedSamples };
}

function* readResolutionSamples(incoming: GpuFrameResolution["samples"]) {
  if (!Array.isArray(incoming) || incoming.length > recordingLimits.frames) {
    invalid("$.resolution.samples", "Expected at most 6000 GPU samples");
  }
  const received = new Set<string>();
  for (const raw of incoming) {
    const sample = readGpuSample(raw, "$.resolution.samples[]");
    if (sample.measurement !== "intervals") {
      invalid("$.resolution.samples[]", "Expected GPU intervals");
    }
    const key = sampleKey(sample);
    if (received.has(key)) {
      invalid("$.resolution.samples[]", "Duplicate GPU frame sequence");
    }
    received.add(key);
    yield sample;
  }
}

function describeFinalization(
  recording: Recording,
  status: RecordingFinalization["status"],
  omittedSamples: number,
  error: string | null,
): RecordingFinalization {
  const observed = new Set<number>();
  const incomplete = new Set<number>();
  for (const sample of recording.gpu) {
    if (sample.measurement === "intervals" && sample.frameId !== null) {
      observed.add(sample.frameId);
      if (sample.completeness === "incomplete") {
        incomplete.add(sample.frameId);
      }
    }
  }
  const missingFrameIds = recording.frames
    .filter((frame) => !observed.has(frame.id))
    .map((frame) => frame.id);
  const incompleteFrameIds = [...incomplete].sort((a, b) => a - b);
  const complete =
    missingFrameIds.length === 0 && incompleteFrameIds.length === 0 && omittedSamples === 0;
  return {
    coverage: summarizeGpuCoverage(recording),
    recording: { ...recording, truncated: recording.truncated || !complete },
    status,
    complete,
    missingFrameIds,
    incompleteFrameIds,
    omittedSamples,
    error,
  };
}

import { type GpuCoverage, summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";
