import { measureGpuIntervals } from "../analysis/gpu-intervals.ts";
import {
  type GpuIncompleteReason,
  type GpuIntervalPass,
  type GpuIntervalSample,
  gpuIntervalLimits,
} from "../core/gpu.ts";

export interface GpuFrameTiming {
  readonly frameId: number | null;
  readonly sequence: number;
  rendererFrameId: number;
  expectedPasses: number;
  readonly passes: Omit<GpuIntervalPass, "startNs" | "endNs">[];
  readonly issues: Set<GpuIncompleteReason>;
}

/** Subtract bigint origins BEFORE conversion; absolute GPU timestamps never become JS numbers. */
export function finishGpuFrame(
  frame: GpuFrameTiming,
  times: BigUint64Array,
  clockId: string,
): GpuIntervalSample {
  const issues = new Set(frame.issues);
  const valid = frame.passes.flatMap((pass, index) => {
    const start = times[index * 2];
    const end = times[index * 2 + 1];
    if (
      start === undefined ||
      end === undefined ||
      end < start ||
      end === 0n ||
      end - start > BigInt(gpuIntervalLimits.spanNs)
    ) {
      issues.add("missing-timestamp");
      return [];
    }
    return [{ pass, start, end }];
  });
  let origin = valid[0]?.start ?? 0n;
  for (const entry of valid) {
    if (entry.start < origin) {
      origin = entry.start;
    }
  }
  const passes = valid.flatMap(({ pass, start, end }) => {
    if (end - origin > BigInt(gpuIntervalLimits.spanNs)) {
      issues.add("missing-timestamp");
      return [];
    }
    return [{ ...pass, startNs: Number(start - origin), endNs: Number(end - origin) }];
  });
  const completeness = issues.size === 0 ? "complete" : "incomplete";
  return {
    measurement: "intervals",
    frameId: frame.frameId,
    rendererFrameId: frame.rendererFrameId,
    sequence: frame.sequence,
    clock: {
      id: clockId,
      domain: "webgpu-timestamp",
      unit: "nanoseconds",
      originNs: origin.toString(),
    },
    passes,
    expectedPasses: frame.expectedPasses,
    omittedPasses: frame.expectedPasses - passes.length,
    completeness,
    issues: [...issues],
    metrics: completeness === "complete" ? measureGpuIntervals(passes) : null,
  };
}
