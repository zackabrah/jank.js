import { expect, test } from "vitest";
import { createHeadroomRun, summarizeStep } from "../../../examples/basic/headroom-run.ts";

const frames = (cpuMs: number, gpuMs: number | null) =>
  Array.from({ length: 40 }, (_, index) => ({
    frameId: index + 1,
    atMs: index * 25,
    cpuMs,
    gpuMs,
    frameMs: 16.7,
  }));

test("budget decisions need two sustained windows and missing GPU time stays unknown", () => {
  const result = summarizeStep({ phase: "gpu", amount: 4 }, frames(2, 18), 16.7);
  expect(result.verdict).toBe("over-budget");
  expect(result.gpuCoverage).toBe(1);
  expect(summarizeStep({ phase: "cpu", amount: 1 }, frames(2, null), 16.7).verdict).toBe(
    "within-budget",
  );
  expect(summarizeStep({ phase: "gpu", amount: 1 }, frames(2, null), 16.7).verdict).toBe(
    "unmeasured",
  );
  const spike = frames(2, 2);
  const first = spike[0];
  if (first) {
    first.cpuMs = 80;
  }
  expect(summarizeStep({ phase: "cpu", amount: 1 }, spike, 16.7).verdict).toBe("within-budget");
  const mixed = frames(2, 2).map((frame, index) => ({ ...frame, cpuMs: index < 20 ? 20 : 2 }));
  expect(summarizeStep({ phase: "cpu", amount: 1 }, mixed, 16.7).verdict).toBe("unstable");
});

test("late and duplicate GPU replies correlate only with measured frame IDs", () => {
  const run = createHeadroomRun({ targetFps: 60, objects: 36, startedAtMs: 0, gpuSupported: true });
  run.tick(600);
  run.frame({ frameId: 1, atMs: 600, cpuMs: 2, frameMs: 16.7 });
  run.gpu(999, 100);
  run.gpu(1, 3);
  run.gpu(1, 4);
  for (let index = 2; index <= 40; index += 1) {
    const atMs = 600 + index * 20;
    run.frame({ frameId: index, atMs, cpuMs: 2, frameMs: 16.7 });
    run.gpu(index, 3);
  }
  run.tick(1600);
  expect(run.work().cpuBatches).toBe(0);
  run.tick(1900);
  expect(run.report().steps[0]?.gpuP95Ms).toBe(3);
  expect(run.report().steps[0]?.gpuSamples).toBe(40);
  run.gpu(1, 1000);
  expect(run.report().steps[0]?.gpuP95Ms).toBe(3);
});

test("a CPU-only run skips GPU stress, stays bounded and makes no GPU recommendation", () => {
  const run = createHeadroomRun({
    targetFps: 60,
    objects: 36,
    startedAtMs: 0,
    gpuSupported: false,
  });
  let frameId = 0;
  for (let time = 0; time <= 65000; time += 20) {
    run.tick(time);
    run.frame({ frameId: ++frameId, atMs: time, cpuMs: 2, frameMs: 16.7 });
    expect(run.work().gpuIterations).toBe(0);
  }
  expect(run.report().status).not.toBe("running");
  expect(run.report().steps.some((step) => step.phase === "gpu")).toBe(false);
  expect(run.report().steps.length).toBeLessThanOrEqual(32);
  expect(run.work()).toMatchObject({ cpuBatches: 0, gpuIterations: 0, objects: 36 });
  run.cancel("late cancellation");
  expect(run.report().reason).not.toBe("late cancellation");
});

test("cancellation and severe workload guards stop adding load without inventing a passing limit", () => {
  const run = createHeadroomRun({
    targetFps: 120,
    objects: 64,
    startedAtMs: 0,
    gpuSupported: true,
  });
  run.cancel("Viewport resized");
  run.tick(1000);
  run.frame({ frameId: 1, atMs: 1000, cpuMs: 1, frameMs: 8.3 });
  expect(run.report()).toMatchObject({
    status: "cancelled",
    reason: "Viewport resized",
    budgetMs: 1000 / 120,
    steps: [],
  });
  expect(run.work()).toMatchObject({ cpuBatches: 0, gpuIterations: 0, objects: 64 });
});

test("severe baseline work aborts during warmup, and the wall clock deadline bounds every run", () => {
  const run = createHeadroomRun({ targetFps: 60, objects: 36, startedAtMs: 0, gpuSupported: true });
  for (let index = 0; index < 3; index += 1) {
    run.tick(index * 150);
    run.frame({ frameId: index, atMs: index * 150, cpuMs: 140, frameMs: 150 });
  }
  expect(run.report().status).toBe("complete");
  expect(run.report().steps[0]?.verdict).toBe("guard");
  const timeout = createHeadroomRun({
    targetFps: 60,
    objects: 36,
    startedAtMs: 0,
    gpuSupported: true,
  });
  timeout.tick(60001);
  expect(timeout.report().status).toBe("complete");
  expect(timeout.report().reason).toContain("time limit");
  expect(timeout.report().steps).toEqual([]);
});

test("recommendations require measured spare time on both CPU and GPU", async () => {
  const { recommendedLevel } = await import("../../../examples/basic/headroom-results.ts");
  const passing = summarizeStep({ phase: "cpu", amount: 1 }, frames(10, 10), 16.7);
  const close = summarizeStep({ phase: "cpu", amount: 2 }, frames(15, 10), 16.7);
  const unknown = summarizeStep({ phase: "cpu", amount: 4 }, frames(2, null), 16.7);
  expect(recommendedLevel([passing, close, unknown], 16.7)?.amount).toBe(1);
  expect(recommendedLevel([unknown], 16.7)).toBeUndefined();
});

test("GPU coverage must be adequate in both windows before reporting a complete GPU estimate", () => {
  const partial = frames(2, 3).map((frame, index) => ({ ...frame, gpuMs: index < 8 ? null : 3 }));
  const step = summarizeStep({ phase: "scene", amount: 72 }, partial, 16.7);
  expect(step.gpuCoverage).toBe(0.8);
  expect(step.gpuP95Ms).toBeNull();
  expect(step.verdict).toBe("within-budget");
});

test.each([
  ["arithmetic", 512, "shader iterations/pixel"],
  ["texture", 512, "texture samples/pixel"],
  ["raymarch", 256, "ray steps/pixel"],
  ["diffusion", 32, "simulation steps/frame"],
] as const)(
  "%s ramps use their own bounded work units and retain their identity",
  async (gpuWorkload, cap, units) => {
    const { phaseSummary } = await import("../../../examples/basic/headroom-results.ts");
    const run = createHeadroomRun({
      targetFps: 60,
      objects: 36,
      startedAtMs: 0,
      gpuSupported: true,
      gpuWorkload,
    });
    for (let atMs = 0, frameId = 0; atMs < 60000 && run.running(); atMs += 20) {
      run.tick(atMs);
      run.frame({ frameId: ++frameId, atMs, cpuMs: 2, frameMs: 16.7 });
      run.gpu(frameId, 2);
      expect(run.work().gpuIterations).toBeLessThanOrEqual(cap);
    }
    const report = run.report();
    expect(report.gpuWorkload).toBe(gpuWorkload);
    expect(report.steps.filter((step) => step.phase === "gpu").at(-1)?.amount).toBe(cap);
    expect(phaseSummary(report, "gpu")).toContain(units);
    expect(report.phaseEnds.gpu).toBe("load cap reached");
  },
);
