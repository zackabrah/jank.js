import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import type { ComparisonTrial } from "../comparison/comparison.ts";
import type { Recording } from "../recordings/recording.ts";
import { summarizeComparison, summarizeComparisonTrial } from "./comparison.ts";

function recording(
  cpuMs = 4,
  measurement: "elapsed-span" | "pass-sum" = "elapsed-span",
): Recording {
  return {
    ...recordingFixture(),
    frames: Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      startedAtMs: index * 20,
      endedAtMs: (index + 1) * 20,
      cpu: { updateMs: cpuMs, renderMs: 0 },
      scopes: [],
      coverage: { status: "complete" as const },
      overhead: { collectionMs: 0, refreshMs: 0 },
    })),
    gpu: Array.from({ length: 50 }, (_, index) => ({
      frameId: index + 1,
      rendererFrameId: index,
      measurement,
      durationMs: 20,
      passes: [],
      omittedPasses: 0,
    })),
  };
}
function trial(pair: number, variant: "A" | "B", capture = recording()): ComparisonTrial {
  return {
    pair,
    variant,
    context: { label: variant, settings: [], resolution: null, animation: "frozen" },
    recording: capture,
    finalization: "settled",
    ...summarizeComparisonTrial(capture, 1000),
  };
}
it("uses median and floor p95 with explicit sample coverage and exact CPU/GPU budgets", () => {
  const summary = summarizeComparisonTrial(recording(), 1000);
  expect(summary.cpu).toEqual({ medianMs: 4, p95Ms: 4, overBudgetPercent: 0, samples: 50 });
  expect(summary.gpu?.overBudgetPercent).toBe(100);
  expect(summary.frame?.overBudgetPercent).toBe(100);
  expect(summary.windowCoverage).toBe(1);
  expect(summary.intervalCoverage.completeFrames).toBe(0);
  expect(summary.gpuCoverage).toBe(1);
});
it("keeps missing, partial, mixed and multiply-correlated GPU evidence unknown", () => {
  const base = recording();
  const intervals = base.frames.map((frame) => ({
    ...gpuIntervalFixture(),
    frameId: frame.id,
    sequence: frame.id,
  }));
  expect(summarizeComparisonTrial({ ...base, gpu: intervals }, 1000).gpu?.medianMs).toBe(8);
  const missing = {
    ...base,
    frames: base.frames.map((frame) => ({ ...frame, cpu: { updateMs: null, renderMs: 2 } })),
  };
  expect(summarizeComparisonTrial(missing, 1000).cpu).toBeNull();
  const partial = intervals.map((sample) => ({
    ...sample,
    metrics: null,
    completeness: "incomplete" as const,
  }));
  expect(summarizeComparisonTrial({ ...base, gpu: partial }, 1000).gpu).toBeNull();
  expect(
    summarizeComparisonTrial({ ...base, gpu: [...base.gpu, ...intervals] }, 1000).gpu,
  ).toBeNull();
  const mixed = [...base.gpu.slice(0, 25), ...intervals.slice(25)];
  expect(summarizeComparisonTrial({ ...base, gpu: mixed }, 1000).gpu).toBeNull();
  expect(
    summarizeComparisonTrial({ ...base, gpu: [{ ...gpuIntervalFixture(), frameId: null }] }, 1000)
      .gpuCoverage,
  ).toBe(0);
  expect(
    summarizeComparisonTrial({ ...base, gpu: [{ ...gpuIntervalFixture(), frameId: 999 }] }, 1000)
      .gpuCoverage,
  ).toBe(0);
});
it("requires 20 samples and 80% window coverage and preserves measured zero", () => {
  const base = recording(0);
  expect(summarizeComparisonTrial(base, 1000).cpu?.medianMs).toBe(0);
  expect(summarizeComparisonTrial(base, 2000).cpu).toBeNull();
  expect(
    summarizeComparisonTrial({ ...base, frames: base.frames.slice(0, 19) }, 380).cpu,
  ).toBeNull();
  expect(summarizeComparisonTrial({ ...base, frames: [], gpu: [] }, 1000)).toMatchObject({
    cpu: null,
    gpu: null,
    frame: null,
    cpuCoverage: 0,
    gpuCoverage: 0,
  });
});
it("compares within pairs with equal trial weight and suppresses incompatible or partial comparisons", () => {
  const trials = [
    trial(1, "A", recording(2)),
    trial(1, "B", recording(4)),
    trial(2, "B", recording(8)),
    trial(2, "A", recording(10)),
  ];
  const comparison = summarizeComparison(trials, 2, true);
  expect(comparison.cpu?.p95.pairedRange).toEqual([-2, 2]);
  expect(comparison.cpu?.p95.deltaMs).toBe(0);
  expect(comparison.gpu?.median.deltaMs).toBe(0);
  expect(summarizeComparison(trials, 2, false).cpu).toBeNull();
  expect(summarizeComparison(trials.slice(0, 3), 2, true).cpu).toBeNull();
  expect(
    summarizeComparison([trial(1, "A", recording(0)), trial(1, "B", recording(1))], 1, true).cpu
      ?.median.deltaPercent,
  ).toBeNull();
  expect(
    summarizeComparison(
      [trials[0] ?? trial(1, "A"), trial(1, "B", recording(4, "pass-sum"))],
      1,
      true,
    ).gpu,
  ).toBeNull();
  expect(
    summarizeComparison([trial(1, "A", { ...recording(), gpu: [] }), trial(1, "B")], 1, true).gpu,
  ).toBeNull();
});
it("does not compare an incomplete B trial or substitute a missing render CPU total", () => {
  const missing = {
    ...recording(),
    frames: recording().frames.map((frame) => ({ ...frame, cpu: { updateMs: 2, renderMs: null } })),
  };
  expect(summarizeComparisonTrial(missing, 1000).cpu).toBeNull();
  expect(summarizeComparison([trial(1, "A"), trial(1, "B", missing)], 1, true).cpu).toBeNull();
});
