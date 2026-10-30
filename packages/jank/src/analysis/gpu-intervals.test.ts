import { describe, expect, it } from "vitest";
import { measureGpuIntervals } from "./gpu-intervals.ts";

describe("GPU interval metrics", () => {
  it("distinguishes sums, busy union and elapsed span across overlapping and nested passes", () => {
    expect(
      measureGpuIntervals([
        { type: "render", startNs: 0, endNs: 4_000_000 },
        { type: "compute", startNs: 2_000_000, endNs: 6_000_000 },
        { type: "compute", startNs: 3_000_000, endNs: 4_000_000 },
        { type: "render", startNs: 8_000_000, endNs: 10_000_000 },
      ]),
    ).toEqual({ renderSumMs: 6, computeSumMs: 5, combinedSumMs: 11, busyMs: 8, elapsedSpanMs: 10 });
  });

  it("handles unsorted, touching, zero-length, compute-only and empty intervals", () => {
    expect(
      measureGpuIntervals([
        { type: "compute", startNs: 10, endNs: 20 },
        { type: "compute", startNs: 0, endNs: 10 },
        { type: "compute", startNs: 4, endNs: 4 },
      ]),
    ).toEqual({
      renderSumMs: 0,
      computeSumMs: 0.00002,
      combinedSumMs: 0.00002,
      busyMs: 0.00002,
      elapsedSpanMs: 0.00002,
    });
    expect(measureGpuIntervals([])).toEqual({
      renderSumMs: 0,
      computeSumMs: 0,
      combinedSumMs: 0,
      busyMs: 0,
      elapsedSpanMs: 0,
    });
  });
});
