import type { GpuIntervalPass, GpuMetrics } from "../core/gpu.ts";

/** Validated offsets on a single GPU clock. Overlap contributes once to busy time. */
export function measureGpuIntervals(
  passes: readonly Pick<GpuIntervalPass, "type" | "startNs" | "endNs">[],
): GpuMetrics {
  let renderNs = 0;
  let computeNs = 0;
  let busyNs = 0;
  let coveredTo = 0;
  const ordered = passes.toSorted((a, b) => a.startNs - b.startNs);
  for (const pass of ordered) {
    const durationNs = pass.endNs - pass.startNs;
    if (pass.type === "render") {
      renderNs += durationNs;
    } else {
      computeNs += durationNs;
    }
    busyNs += Math.max(0, pass.endNs - Math.max(pass.startNs, coveredTo));
    coveredTo = Math.max(coveredTo, pass.endNs);
  }
  return {
    renderSumMs: renderNs / 1e6,
    computeSumMs: computeNs / 1e6,
    combinedSumMs: (renderNs + computeNs) / 1e6,
    busyMs: busyNs / 1e6,
    elapsedSpanMs: (coveredTo - (ordered[0]?.startNs ?? 0)) / 1e6,
  };
}
