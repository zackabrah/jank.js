import type { GpuSample } from "../core/gpu.ts";
import type { Recording } from "../recordings/recording.ts";

/** Frame counts are deduplicated; timestamp pairs count retained observations, including repeated brackets. */
export function summarizeGpuEvidence(recording: Pick<Recording, "frames" | "gpu">) {
  const frames = new Map(recording.frames.map((frame) => [frame.id, [] as GpuSample[]]));
  for (const sample of recording.gpu) {
    if (sample.frameId !== null) {
      frames.get(sample.frameId)?.push(sample);
    }
  }
  const result = {
    totalFrames: frames.size,
    intervalFrames: 0,
    sampledFrames: 0,
    validFrames: 0,
    completeFrames: 0,
    validPairs: 0,
    rejectedPairs: 0,
    omittedPasses: 0,
    sampledOutFrames: 0,
    missingFrames: 0,
  };
  for (const samples of frames.values()) {
    if (!samples.length) {
      result.missingFrames += 1;
      continue;
    }
    const intervals = samples.filter((sample) => sample.measurement === "intervals");
    result.intervalFrames += Number(intervals.length > 0);
    result.sampledFrames += Number(samples.some(hasSample));
    result.validFrames += Number(samples.some(hasTiming));
    result.completeFrames += Number(samples.every(isComplete));
    result.sampledOutFrames += Number(
      samples.every(
        (sample) =>
          sample.measurement === "intervals" &&
          sample.issues.length === 1 &&
          sample.issues[0] === "sampled-out",
      ),
    );
    for (const sample of intervals) {
      result.validPairs += sample.passes.length;
      result.rejectedPairs += sample.rejectedPasses.length;
    }
    for (const sample of samples) {
      result.omittedPasses += sample.omittedPasses;
    }
  }
  return result;
}
function hasTiming(sample: GpuSample): boolean {
  return sample.measurement === "intervals"
    ? sample.passes.length > 0
    : sample.durationMs !== null || sample.passes.some((pass) => pass.durationMs !== null);
}
function hasSample(sample: GpuSample): boolean {
  return sample.measurement === "intervals"
    ? sample.passes.length + sample.rejectedPasses.length > 0 || sample.completeness === "complete"
    : hasTiming(sample);
}
function isComplete(sample: GpuSample): boolean {
  return sample.measurement === "intervals"
    ? sample.completeness === "complete"
    : sample.durationMs !== null && sample.omittedPasses === 0;
}
