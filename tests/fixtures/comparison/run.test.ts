import { describe, expect, it } from "vitest";
import {
  type ComparisonOptions,
  createComparisonRun,
  summarizeComparison,
} from "../../../examples/basic/comparison-run.ts";

const options: ComparisonOptions = {
  a: { objects: 36, cpuMs: 0, animate: true, scale: 1 },
  b: { objects: 144, cpuMs: 2, animate: false, scale: 0.5 },
  targetFps: 60,
  warmupMs: 500,
  measureMs: 1000,
  pairs: 2,
  startedAtMs: 0,
};

function finishRun(gpu = true) {
  const run = createComparisonRun(options);
  let frameId = 1;
  for (let atMs = 0; run.running() && atMs < 12000; atMs += 10) {
    run.tick(atMs);
    run.frame({ frameId, atMs, cpuMs: run.progress().variant === "A" ? 2 : 4 });
    if (gpu) {
      run.gpu(frameId, 3);
      run.gpu(frameId, 999);
    }
    frameId += 1;
  }
  return run;
}

describe("repeatable A/B windows", () => {
  it("alternates paired order, excludes warmup/drain, and deduplicates GPU replies", () => {
    const report = finishRun().report();
    expect(report.status).toBe("complete");
    expect(report.trials.map((trial) => trial.variant)).toEqual(["A", "B", "B", "A"]);
    expect(report.trials.every((trial) => trial.frames === 100 && trial.gpuCoverage === 1)).toBe(
      true,
    );
    expect(report.trials[0]?.cpu?.p95Ms).toBe(2);
    expect(report.trials[0]?.gpu?.p95Ms).toBe(3);
    const summary = summarizeComparison(report);
    expect(summary.cpu?.deltaMs).toBe(2);
    expect(summary.cpu?.deltaPercent).toBe(100);
    expect(summary.cpu?.pairedDeltaRangeMs).toEqual([2, 2]);
  });
  it("preserves unavailable GPU data and refuses a conclusion from incomplete pairs", () => {
    const report = finishRun(false).report();
    expect(report.trials.every((trial) => trial.gpu === null && trial.gpuCoverage === 0)).toBe(
      true,
    );
    expect(summarizeComparison(report).gpu).toBeNull();
    const run = createComparisonRun(options);
    run.tick(501);
    run.frame({ frameId: 1, atMs: 501, cpuMs: 5 });
    run.cancel("Tab hidden");
    expect(run.report().trials).toEqual([]);
    expect(run.report().reason).toBe("Tab hidden");
    expect(summarizeComparison(run.report()).cpu).toBeNull();
  });
  it("accepts delayed GPU replies only for measured frames through the bounded drain", () => {
    const run = createComparisonRun(options);
    run.frame({ frameId: 1, atMs: 100, cpuMs: 900 });
    run.tick(500);
    for (let id = 2; id <= 101; id += 1) {
      const atMs = 500 + (id - 2) * 10;
      run.tick(atMs);
      run.frame({ frameId: id, atMs, cpuMs: 2 });
    }
    run.tick(1500);
    for (let id = 1; id <= 101; id += 1) {
      run.gpu(id, 5);
    }
    run.tick(2000);
    expect(run.report().trials[0]?.gpu?.p95Ms).toBe(5);
    run.gpu(2, 999);
    expect(run.report().trials[0]?.gpu?.p95Ms).toBe(5);
  });
  it("never includes a frame spanning a measurement boundary, and marks sparse trials unknown", () => {
    const run = createComparisonRun(options);
    run.tick(500);
    run.frame({ frameId: 1, atMs: 500, cpuMs: 1 });
    run.tick(1450);
    run.frame({ frameId: 2, atMs: 1450, cpuMs: 8 });
    run.tick(1550);
    run.tick(2050);
    expect(run.report().trials[0]?.frames).toBe(1);
    expect(run.report().trials[0]?.cpu).toBeNull();
  });
  it("cancels on capacity/time limits, validates bounded configuration and detaches settings", () => {
    expect(() => createComparisonRun({ ...options, pairs: 100 })).toThrow();
    expect(() => createComparisonRun({ ...options, a: { ...options.a, objects: NaN } })).toThrow();
    const run = createComparisonRun(options);
    const saved = run.report();
    expect(saved.options.a).not.toBe(options.a);
    run.tick(500);
    for (let id = 1; id < 2100 && run.running(); id += 1) {
      run.tick(500 + id / 10);
      run.frame({ frameId: id, atMs: 500 + id / 10, cpuMs: 0 });
    }
    expect(run.report().status).toBe("cancelled");
    expect(run.report().reason).toContain("capacity");
    const expired = createComparisonRun(options);
    expired.tick(200000);
    expect(expired.report().status).toBe("cancelled");
  });
});

it("requires GPU coverage in every trial and reports mixed paired differences without pooling", () => {
  const run = createComparisonRun(options);
  let frameId = 1;
  for (let atMs = 0; run.running() && atMs < 12000; atMs += 10) {
    run.tick(atMs);
    const progress = run.progress();
    const cpuMs = progress.variant === "A" ? 4 : progress.pair * 4 - 2;
    run.frame({ frameId, atMs, cpuMs });
    if (progress.variant === "A" || frameId % 2 === 0) {
      run.gpu(frameId, 3);
    }
    frameId += 1;
  }
  const report = run.report();
  expect(
    report.trials.filter((trial) => trial.variant === "B").every((trial) => trial.gpu === null),
  ).toBe(true);
  expect(summarizeComparison(report).gpu).toBeNull();
  expect(summarizeComparison(report).cpu?.pairedDeltaRangeMs).toEqual([-2, 2]);
  expect(summarizeComparison(report).cpu?.deltaMs).toBe(0);
});

it("ignores pre-start RAF boundaries and cancels severe CPU load without publishing partial data", () => {
  const run = createComparisonRun({ ...options, startedAtMs: 5 });
  run.tick(0);
  expect(run.running()).toBe(true);
  for (let id = 1; id <= 3; id += 1) {
    run.tick(5 + id * 10);
    run.frame({ frameId: id, atMs: 5 + id * 10, cpuMs: 110 });
  }
  expect(run.report().status).toBe("cancelled");
  expect(run.report().trials).toEqual([]);
});

it("does not infer performance from a sparse time window even when it has twenty frames", () => {
  const run = createComparisonRun(options);
  run.tick(500);
  for (let id = 1; id <= 21; id += 1) {
    const atMs = 500 + (id - 1) * 10;
    run.tick(atMs);
    run.frame({ frameId: id, atMs, cpuMs: 1 });
    run.gpu(id, 1);
  }
  run.tick(1600);
  run.tick(2100);
  const trial = run.report().trials[0];
  expect(trial?.frames).toBe(20);
  expect(trial?.windowCoverage).toBe(0.2);
  expect(trial?.cpu).toBeNull();
  expect(trial?.gpu).toBeNull();
  expect(trial?.frame).toBeNull();
});
