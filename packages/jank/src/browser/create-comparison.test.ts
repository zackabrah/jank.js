import { expect, it, vi } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import {
  copyComparisonContext,
  selectComparisonWindow,
  serializeComparison,
} from "../comparison/recordings.ts";
import type { GpuFrameResolution, GpuFrameResolver } from "../core/gpu.ts";
import { createComparison } from "./create-comparison.ts";
import { createProfiler } from "./create-profiler.ts";

function fixture(resolver?: GpuFrameResolver) {
  const fault = { apply: false, restore: false, check: "" };
  let now = 0;
  let variant = "A";
  const profiler = createProfiler({ now: () => now });
  const restore = vi.fn(() => {
    if (fault.restore) {
      throw new Error("Restore failed");
    }
  });
  const apply = vi.fn((next: "A" | "B") => {
    if (fault.apply) {
      throw "Apply failed";
    }
    variant = next;
    return {
      label: next,
      settings: [{ label: "Objects", value: next === "A" ? 64 : 128 }],
      resolution: { widthPx: 800, heightPx: 600 },
      animation: "frozen",
    };
  });
  const comparison = createComparison({
    profiler,
    ...(resolver ? { gpuResolver: resolver } : {}),
    host: { begin: () => ({ apply, restore, check: () => fault.check || null }) },
  });
  async function frames(count: number, interval = 16) {
    for (let index = 0; index < count; index++) {
      now += interval;
      const id = profiler.beginFrame(now);
      comparison.tick(now, id);
      profiler.endFrame({ updateMs: variant === "A" ? 2 : 4, renderMs: 1 });
      await Promise.resolve();
    }
  }
  return { profiler, comparison, restore, apply, frames, fault };
}
it("runs alternating paired windows on host boundaries and exports the underlying sealed recordings", async () => {
  const f = fixture();
  f.comparison.start({ pairs: 2, warmupMs: 500, measureMs: 1000 });
  await f.frames(550);
  const report = f.comparison.report();
  expect(report?.status).toBe("complete");
  expect(report?.trials.map((trial) => trial.variant)).toEqual(["A", "B", "B", "A"]);
  expect(report?.trials.every((trial) => trial.recording.frames.length >= 60)).toBe(true);
  expect(report?.summary.cpu?.median.deltaMs).toBe(2);
  expect(report?.summary.gpu).toBeNull();
  expect(f.restore).toHaveBeenCalledTimes(1);
  expect(f.profiler.capture.getState().status).toBe("idle");
});
it("refuses to steal a recording, cancels its own capture, and restores once", async () => {
  const f = fixture();
  f.profiler.capture.start();
  expect(() => f.comparison.start({ pairs: 2, warmupMs: 500, measureMs: 1000 })).toThrow(
    "Stop or disarm",
  );
  f.profiler.capture.stop();
  f.comparison.start({ pairs: 2, warmupMs: 500, measureMs: 1000 });
  await f.frames(40);
  f.comparison.cancel("Stopped by user");
  f.comparison.dispose();
  expect(f.restore).toHaveBeenCalledTimes(1);
  expect(f.comparison.report()?.summary.cpu).toBeNull();
});

const options = { pairs: 2, warmupMs: 500, measureMs: 1000 };
it("validates run/context inputs before capturing and reports host failures", async () => {
  const f = fixture();
  expect(f.comparison.report()).toBeNull();
  expect(() => f.comparison.start({ ...options, pairs: 7 })).toThrow(RangeError);
  for (const invalid of [{ warmupMs: NaN }, { measureMs: 0 }, { pairs: 2.5 }]) {
    expect(() => f.comparison.start({ ...options, ...invalid })).toThrow();
  }
  f.comparison.start(options);
  expect(() => f.comparison.start(options)).toThrow("already running");
  f.fault.apply = true;
  await f.frames(1);
  expect(f.comparison.snapshot().reason).toBe("Comparison host failed.");
  f.fault.apply = false;
  f.fault.restore = true;
  f.comparison.start(options);
  f.fault.check = "Viewport changed";
  await f.frames(1);
  expect(f.comparison.snapshot().reason).toContain("Host restoration failed");
  f.comparison.dispose();
  expect(() => f.comparison.start(options)).toThrow("disposed");
});
it("cancels on clock, budget, capture and time-limit changes without taking another capture", async () => {
  for (const action of ["clock", "budget", "capture", "clear", "timeout"] as const) {
    const f = fixture();
    f.comparison.start(options);
    await f.frames(40);
    if (action === "clock") {
      f.comparison.tick(NaN, -1);
    }
    if (action === "budget") {
      f.profiler.setTargetFps(30);
      await f.frames(100);
    }
    if (action === "capture") {
      f.profiler.capture.stop();
      await f.frames(1);
    }
    if (action === "clear") {
      f.profiler.clear();
      await f.frames(1);
    }
    if (action === "timeout") {
      await f.frames(1, 100000);
    }
    expect(f.comparison.snapshot().status).toBe("cancelled");
    expect(f.restore).toHaveBeenCalledTimes(1);
  }
  const f = fixture();
  f.comparison.start(options);
  f.profiler.capture.start();
  await f.frames(1);
  expect(f.profiler.capture.getState().status).toBe("manual");
});
it("finalizes interval recordings and stale completions cannot enter a newer run", async () => {
  const deferred = Promise.withResolvers<GpuFrameResolution>();
  const resolveFrames = vi
    .fn()
    .mockReturnValueOnce(deferred.promise)
    .mockImplementation(async (ids: number[]) => ({
      status: "settled",
      pendingFrameIds: [],
      samples: ids.map((id) => ({ ...gpuIntervalFixture(), frameId: id, sequence: id })),
    }));
  const f = fixture({ resolveFrames });
  f.comparison.start(options);
  await f.frames(132);
  expect(f.comparison.snapshot().stage).toBe("finalize");
  f.comparison.cancel();
  f.comparison.start(options);
  deferred.resolve({ status: "settled", samples: [], pendingFrameIds: [] });
  await f.frames(600);
  const report = f.comparison.report();
  expect(report?.status).toBe("complete");
  expect(report?.summary.gpu?.median.a).toBe(8);
  expect(report?.trials[0]?.intervalCoverage.coveragePercent).toBe(100);
  expect(f.restore).toHaveBeenCalledTimes(2);
  if (!report) {
    throw new Error("Missing report");
  }
  expect(JSON.parse(serializeComparison(report)).trials).toHaveLength(4);
  // Snapshots and exports cannot mutate retained measurements or context.
  const copy = f.comparison.snapshot();
  Object.assign(copy.trials[0]?.context.settings[0] ?? {}, { value: 999 });
  Object.assign(report.trials[0]?.recording.frames[0]?.cpu ?? {}, { updateMs: 999 });
  expect(f.comparison.report()?.trials[0]?.recording.frames[0]?.cpu.updateMs).toBe(2);
  expect(f.comparison.snapshot().trials[0]?.context.settings[0]?.value).toBe(64);
});
it("records resolver errors as diagnostic evidence without inventing GPU timings", async () => {
  const f = fixture({
    resolveFrames: async () => {
      throw new Error("Device lost");
    },
  });
  f.comparison.start(options);
  await f.frames(600);
  expect(f.comparison.report()?.status).toBe("complete");
  expect(f.comparison.report()?.summary.gpu).toBeNull();
  expect(f.comparison.report()?.trials[0]?.finalization).toContain("Device lost");
});
it("validates context bounds and excludes drain events and unrelated GPU samples", () => {
  const context = {
    label: "A",
    settings: [{ label: "Enabled", value: true }],
    resolution: null,
    animation: "Frozen",
  };
  expect(copyComparisonContext(context)).toEqual(context);
  expect(
    copyComparisonContext({ ...context, settings: [{ label: "Scene", value: "Clouds" }] }).settings,
  ).toHaveLength(1);
  for (const invalid of [
    { label: "" },
    { animation: "a".repeat(257) },
    { settings: [{ label: "X", value: NaN }] },
    { resolution: { widthPx: 0, heightPx: 2 } },
  ]) {
    expect(() => copyComparisonContext({ ...context, ...invalid })).toThrow();
  }
  const recording = recordingFixture();
  expect(selectComparisonWindow(recording, 2, 16).frames.map((frame) => frame.id)).toEqual([2]);
  expect(selectComparisonWindow(recording, 999, 16).frames).toEqual([]);
});

it("reports capture capacity and refuses an oversized combined export", async () => {
  const f = fixture();
  f.comparison.start({ ...options, measureMs: 10000 });
  await f.frames(6600, 1);
  expect(f.comparison.snapshot().reason).toContain("capacity reached");
  expect(f.comparison.snapshot().trials).toHaveLength(0);
  expect(f.profiler.capture.list().at(-1)?.truncated).toBe(true);
  const report = f.comparison.report();
  if (!report) {
    throw new Error("Expected cancelled report");
  }
  expect(() => serializeComparison({ ...report, reason: "π".repeat(16 * 1024 * 1024) })).toThrow(
    "32 MiB",
  );
});
