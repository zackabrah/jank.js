import type { GpuIncompleteReason, GpuSample } from "../core/gpu.ts";
import type { Recording } from "../recordings/recording.ts";

export interface GpuCoverage {
  readonly totalFrames: number;
  readonly completeFrames: number;
  readonly incompleteFrames: number;
  readonly sampledFrames: number;
  /** No interval evidence; may be pending, disabled, unsupported or no longer retained. */
  readonly missingFrames: number;
  readonly coveragePercent: number | null;
  /** Counts frames with each reason; a frame can have multiple reasons. */
  readonly reasons: readonly { readonly reason: GpuIncompleteReason; readonly frames: number }[];
}

export function summarizeGpuCoverage(recording: Pick<Recording, "frames" | "gpu">): GpuCoverage {
  return gpuCoverage(
    recording.frames.map((frame) => frame.id),
    recording.gpu,
  );
}

/** Accepts borrowed observations so live progress need not copy every retained pass. */
export function gpuCoverage(
  frameIds: readonly number[],
  samples: Iterable<GpuSample>,
): GpuCoverage {
  const frames = collectFrameIssues(frameIds, samples);
  let completeFrames = 0;
  let incompleteFrames = 0;
  let sampledFrames = 0;
  let missingFrames = 0;
  const reasons = new Map<GpuIncompleteReason, number>();
  for (const frame of frames.values()) {
    if (!frame.observed) {
      missingFrames += 1;
    } else if (frame.issues.size === 0) {
      completeFrames += 1;
    } else if (frame.issues.size === 1 && frame.issues.has("sampled-out")) {
      sampledFrames += 1;
    } else {
      incompleteFrames += 1;
    }
    for (const reason of frame.issues) {
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  return {
    totalFrames: frames.size,
    completeFrames,
    incompleteFrames,
    sampledFrames,
    missingFrames,
    coveragePercent: frames.size === 0 ? null : (completeFrames / frames.size) * 100,
    reasons: [...reasons].map(([reason, count]) => ({ reason, frames: count })),
  };
}

function collectFrameIssues(frameIds: readonly number[], samples: Iterable<GpuSample>) {
  const frames = new Map(
    frameIds.map((id) => [id, { observed: false, issues: new Set<GpuIncompleteReason>() }]),
  );
  for (const sample of samples) {
    if (sample.measurement !== "intervals" || sample.frameId === null) {
      continue;
    }
    const frame = frames.get(sample.frameId);
    if (frame) {
      frame.observed = true;
      for (const issue of sample.issues) {
        frame.issues.add(issue);
      }
    }
  }
  return frames;
}
