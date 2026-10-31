import { type GpuRejectedPass, gpuIntervalLimits } from "../core/gpu.ts";

/** Shared acceptance policy for live collection and the explicit native probe. */
export function timestampPairRejection(
  start: bigint | undefined,
  end: bigint | undefined,
): GpuRejectedPass["reason"] | null {
  if (start === undefined || end === undefined) {
    return "missing-timestamp";
  }
  if (start === 0n || end === 0n) {
    return "zero-timestamp";
  }
  if (end < start) {
    return "reversed-timestamp";
  }
  if (end - start > BigInt(gpuIntervalLimits.spanNs)) {
    return "out-of-range-timestamp";
  }
  return null;
}
