import { expect, test } from "vitest";
import { readLive } from "../src/live/model.ts";
import { createSyntheticSource } from "./synthetic-source.ts";

test("cycles through repeatable spikes and CPU/GPU bursts with bounded, coherent sample histories", () => {
  const demo = createSyntheticSource();
  const replay = createSyntheticSource();
  const phases = new Set<string>();
  let sawSpike = false;
  let sawGpuBurst = false;
  let sawCpuBurst = false;
  const original = demo.snapshot();
  for (let index = 0; index < 128; index++) {
    const snapshot = demo.advance(250);
    expect(snapshot).toEqual(replay.advance(250));
    const model = readLive(snapshot);
    phases.add(demo.phase);
    expect(model.frames).toHaveLength(180);
    expect(model.gpu?.ageFrames).toBe(2);
    expect(model.gpu?.sampleFrame).toBe((model.frames.at(-1)?.id ?? 0) - 2);
    expect(model.gpu?.busy.status).toBe("unknown");
    expect(model.gpu?.completeness).toBe("complete");
    sawSpike ||= model.frames.some((frame) => frame.interval === 80);
    sawGpuBurst ||= model.gpu?.timedWork?.status === "measured" && model.gpu.timedWork.value > 25;
    sawCpuBurst ||= model.cpu.some(
      (row) =>
        row.id === "simulation" && row.duration.status === "measured" && row.duration.value > 8,
    );
    for (const frame of model.frames) {
      expect(
        frame.scopes.every(
          (scope) => scope.start >= frame.at - frame.interval && scope.end <= frame.at,
        ),
      ).toBe(true);
    }
  }
  expect(phases).toEqual(new Set(["Smooth", "Recovery", "CPU burst", "GPU burst"]));
  expect(sawSpike && sawCpuBurst && sawGpuBurst).toBe(true);
  expect(original.diagnostics.frames.at(-1)?.id).toBe(179);
});

test("manual injections and budget changes update synthetic data without rewriting history", () => {
  const demo = createSyntheticSource();
  demo.inject("CPU spike");
  const spike = demo.advance(250);
  expect(spike.diagnostics.frames.filter((frame) => frame.interval === 80)).toHaveLength(1);
  const event = readLive(spike).events?.find((entry) => entry.label === "CPU spike");
  expect(event?.frameId).toBe(spike.diagnostics.frames.find((frame) => frame.interval === 80)?.id);
  expect(event?.detail).toContain("Simulated");
  demo.inject("CPU burst");
  for (let index = 0; index < 6; index++) demo.advance(250);
  expect(demo.phase).toBe("CPU burst");
  demo.inject("GPU burst");
  const gpu = demo.advance(250).gpu;
  expect(gpu?.timedWork).toMatchObject({ status: "measured" });
  if (gpu?.timedWork?.status === "measured") expect(gpu.timedWork.value).toBeGreaterThan(25);
  const before = demo.snapshot();
  demo.setBudget(25);
  expect(demo.snapshot().diagnostics.frames).toEqual(before.diagnostics.frames);
  expect(demo.snapshot().diagnostics.budget.frameMs).toBe(25);
  for (const invalid of [NaN, Infinity, -1, 1001])
    expect(() => demo.advance(invalid)).toThrow(RangeError);
  expect(() => demo.setBudget(0)).toThrow(RangeError);
  expect(demo.snapshot().diagnostics.budget.frameMs).toBe(25);
});
