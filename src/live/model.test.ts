import { expect, test } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { gpuFrameToLive } from "../gpu/model.ts";
import { liveFixture } from "./fixtures.ts";
import { type DiagnosticsSnapshot, judgeBudget, measured, readLive } from "./model.ts";

const frame = (id: number, interval = 10): DiagnosticsSnapshot["frames"][number] => ({
  id,
  at: id * interval,
  interval,
  coverage: "complete",
  scopes: [],
  overhead: { collectionMs: 0.1, refreshMs: 0.2 },
});

test("GPU summary counts and sample identity must agree with validated invocation evidence", () => {
  const fixture = liveFixture();
  const evidence = gpuFixture(100);
  const gpu = gpuFrameToLive(evidence, 102);
  expect(readLive({ ...fixture, gpu }).gpu?.timed).toBe(1);
  for (const change of [
    { expected: 2 },
    { timed: 0 },
    { completeness: "unknown" as const },
    { sampleFrame: 101 },
  ])
    expect(() => readLive({ ...fixture, gpu: { ...gpu, ...change } })).toThrow(
      "must match its invocation evidence",
    );
  expect(() =>
    readLive({
      ...fixture,
      gpu: { ...gpu, evidence: { ...evidence, omitted: -1 } },
    }),
  ).toThrow("Invalid GPU frame evidence");
});

function sample(frames: DiagnosticsSnapshot["frames"]) {
  const source = liveFixture(true);
  return { ...source, diagnostics: { ...source.diagnostics, frames } };
}

test("uses 180-frame nearest-rank statistics and one full second for FPS", () => {
  const view = readLive(sample(Array.from({ length: 200 }, (_, i) => frame(i + 1))));
  expect(view.frames).toHaveLength(180);
  expect(view.p95).toEqual(measured(10));
  expect(view.fps).toEqual(measured(100));
  expect(view.worstFrame).toBe(21);
  expect(view.worstAge).toBeCloseTo(1.79);
  expect(view.over).toEqual(measured(0));
  expect(readLive(sample([frame(1)])).fps.status).toBe("unknown");
  expect(readLive(sample([])).p95.status).toBe("unknown");
  expect(readLive(sample([])).cpu[0]?.duration.status).toBe("unknown");
  expect(readLive(sample([frame(1, 0)])).p95).toEqual(measured(0));
});

test("allows the larger of 1 ms or 5% before flagging a budget crossing", () => {
  const source = sample([
    frame(1, 16),
    { ...frame(2), interval: 16.8 },
    { ...frame(3), interval: 17.6 },
    { ...frame(4), interval: 18 },
  ]);
  const view = readLive(source);
  expect(view.tolerance).toBe(1);
  expect(view.overLimit).toBeCloseTo(17.667);
  expect(view.overCount).toBe(1);
  expect(view.p95).toEqual(measured(18));
});

test("clips and unions nested CPU scopes, excludes partial frames, and preserves absence versus zero", () => {
  const scope = (system: string, start: number, end: number) => ({
    system,
    label: system,
    start,
    end,
  });
  const source = sample([
    {
      ...frame(1),
      scopes: [
        scope("simulation", 0, 7),
        scope("simulation", 2, 4),
        scope("simulation", 6, 15),
        scope("render", 5, 8),
        scope("zero", 3, 3),
      ],
    },
    { ...frame(2), scopes: [scope("simulation", 10, 12)] },
    { ...frame(3), coverage: "truncated", scopes: [scope("simulation", 20, 30)] },
  ]);
  source.diagnostics.systems = [
    ...source.diagnostics.systems,
    { id: "absent", label: "Absent", values: {} },
  ];
  const view = readLive(source);
  expect(view.complete).toBe(2);
  expect(view.excluded).toBe(1);
  expect(view.cpu.find((row) => row.id === "simulation")?.duration).toEqual(measured(6));
  expect(view.cpu.find((row) => row.id === "render")?.duration).toEqual(measured(1.5));
  expect(view.cpu.find((row) => row.id === "zero")?.duration).toEqual(measured(0));
  expect(view.cpu.find((row) => row.id === "absent")?.duration.status).toBe("not-observed");
  expect(view.unattributed).toEqual(measured(4));
});

test("uses combined per-frame overhead peaks and validates source data", () => {
  const source = sample([
    { ...frame(1), overhead: { collectionMs: 2, refreshMs: 0 } },
    { ...frame(2), overhead: { collectionMs: 0, refreshMs: 3 } },
  ]);
  expect(readLive(source).overhead.mean).toEqual(measured(2.5));
  expect(readLive(source).overhead.peak).toEqual(measured(3));
  for (const frames of [
    [frame(2), frame(1)],
    [{ ...frame(1), interval: Infinity }],
    [{ ...frame(1), scopes: [{ system: "x", label: "x", start: 5, end: 1 }] }],
  ]) {
    expect(() => readLive(sample(frames))).toThrow(RangeError);
  }
  const fixture = liveFixture();
  const gpu = fixture.gpu;
  if (!gpu) throw new Error("Missing GPU fixture");
  expect(() => readLive({ ...fixture, gpu: { ...gpu, expected: 4 } })).toThrow("completeness");
  expect(
    readLive({
      ...fixture,
      gpu: { ...gpu, completeness: "unknown", expected: null, timed: null },
    }).gpu?.completeness,
  ).toBe("unknown");
});

test("a light scene on a slow display isn't over budget, and a real hitch still is", () => {
  const fixture = liveFixture();
  let at = 0;
  const frames = Array.from({ length: 100 }, (_, index) => {
    const interval = index === 50 ? 40 : index % 2 ? 17.5 : 17.7;
    at += interval;
    return { ...frame(index + 1, interval), at };
  });
  const diagnostics = { ...fixture.diagnostics, frames, budget: { frameMs: 1000 / 60 } };
  const gpu = gpuFrameToLive(gpuFixture(100), 102);
  const paced = readLive({ diagnostics, gpu });
  expect(paced.displayPacedMs).toBeCloseTo(17.6);
  expect(paced.overCount).toBe(1);
  expect(paced.overLimit).toBeCloseTo(18.6);
  // Frozen frames are judged again, and must reach the same answer.
  expect(judgeBudget(frames, 1000 / 60, paced.workMs).overCount).toBe(1);
  expect(judgeBudget(frames, 50, paced.workMs)).toMatchObject({
    tolerance: 2.5,
    overLimit: 52.5,
  });
  const unknownGpu = readLive({ diagnostics, gpu: null });
  expect(unknownGpu.displayPacedMs).toBeNull();
  // Without GPU timing the budget's own limit applies: 17.7 ms frames are over 17.667 ms, 17.5 ms aren't.
  expect(unknownGpu.overCount).toBe(50);
});
