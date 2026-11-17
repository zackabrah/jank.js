import { expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import type { ComparisonBundle, VariantKey } from "../compare/model.ts";
import { comparisonFrames } from "./comparison-frames.ts";
import {
  type ComparisonLane,
  comparisonLaneGeometry,
  comparisonLanes,
  comparisonLaneValues,
} from "./comparison-lanes.ts";
import type { LaneValue } from "./lanes.ts";

function values(
  bundle: ComparisonBundle,
  group: ComparisonLane["group"],
  label: string,
  key: VariantKey = "A",
) {
  const model = comparisonLanes(bundle, 1);
  const chart = comparisonFrames(bundle, 1);
  const lane = model.lanes.find((lane) => lane.group === group && lane.label === label);
  const source = model.sources.find((source) => source.key === key);
  const points = chart.series.find((series) => series.key === key)?.points;
  if (!lane || !source || !points) throw new Error(`Missing lane ${label}`);
  return {
    lane,
    points,
    values: comparisonLaneValues(source, lane, points),
    duration: chart.duration,
  };
}

test("CPU lanes union scopes, keep system identity and use zero only for complete frames", () => {
  const bundle = comparisonFixture();
  const a = bundle.trials[0]?.recording,
    b = bundle.trials[1]?.recording;
  const first = a?.frames[0],
    partial = a?.frames[1];
  if (!a || !b || !first || !partial) throw new Error("Missing frames");
  first.scopes = [
    { system: "simulation", label: "physics", start: 500, end: 508 },
    { system: "simulation", label: "physics", start: 504, end: 512 },
    { system: "other", label: "physics", start: 500, end: 501 },
  ];
  partial.coverage = "truncated";
  partial.droppedScopes = 1;
  for (const frame of b.frames)
    frame.scopes = frame.scopes.filter((scope) => scope.label !== "physics");
  const result = values(bundle, "cpu", "physics");
  expect(result.values[0]).toMatchObject({ value: 12, status: "measured" });
  expect(result.values[1]).toMatchObject({ value: 2, status: "partial" });
  expect(values(bundle, "cpu", "physics", "B").values[0]).toMatchObject({
    value: 0,
    status: "measured",
  });
  expect(comparisonLanes(bundle, 1).lanes.filter((lane) => lane.label === "physics")).toHaveLength(
    2,
  );
  const plot = comparisonLaneGeometry(result.points, result.values, result.duration, 0, 30);
  expect(plot.path.match(/M/g)).toHaveLength(2);
  expect(plot.missing).not.toBe("");
});

test("GPU lanes preserve explicit links, repeated occurrences and missing/zero/failure states", () => {
  const bundle = comparisonFixture();
  const a = bundle.trials[0]?.recording,
    b = bundle.trials[1]?.recording;
  const gpu = a?.gpuTiming;
  if (!a || !b || !gpu) throw new Error("Missing GPU fixture");
  a.frames.forEach((frame, index) => {
    frame.id = 1001 + index * 3;
  });
  gpu.frames.forEach((record, index) => {
    record.frameId = 1001 + index * 3;
  });
  const [zero, , pending, rejected, unknown, absent] = gpu.frames;
  const invocation = zero?.invocations[0];
  if (!zero || !invocation || !pending || !rejected || !unknown || !absent)
    throw new Error("Missing records");
  Object.assign(invocation, { milliseconds: 0, startMs: 0, endMs: 0 });
  zero.invocations.push({ ...invocation, id: "second", milliseconds: 3, endMs: 3 });
  pending.invocations = [
    {
      ...invocation,
      state: "pending",
      milliseconds: null,
      startMs: null,
      endMs: null,
      reason: "Waiting",
    },
  ];
  rejected.invocations = [
    {
      ...invocation,
      state: "rejected",
      milliseconds: null,
      startMs: null,
      endMs: null,
      reason: "Reset",
    },
  ];
  unknown.inventory = "unknown";
  unknown.invocations = [];
  absent.invocations = [];
  gpu.frames.splice(1, 1);
  delete b.gpuTiming;
  const result = values(bundle, "gpu", "SIMULATED render ×1");
  expect(result.values.slice(0, 6).map((cell) => cell.status)).toEqual([
    "measured",
    "missing",
    "pending",
    "rejected",
    "unknown",
    "absent",
  ]);
  expect(result.values[0]?.value).toBe(0);
  expect(values(bundle, "gpu", "SIMULATED render ×2").values[0]?.value).toBe(3);
  expect(
    values(bundle, "gpu", "SIMULATED render ×1", "B").values.every(
      (cell) => cell.value === null && cell.status === "missing",
    ),
  ).toBe(true);
  const plot = comparisonLaneGeometry(result.points, result.values, result.duration, 0, 4);
  expect(plot.path).toMatch(/^M0,100H/);
  expect(plot.path.match(/M/g)).toHaveLength(2);
  expect(plot.missing).not.toBe("");
});

test("counter lanes use snapshots at frame start, preserve age and never use later or final values", () => {
  const bundle = comparisonFixture();
  const a = bundle.trials[0]?.recording,
    b = bundle.trials[1]?.recording;
  if (!a || !b) throw new Error("Missing trials");
  const system = (value: number | null | string) => ({
    id: "world",
    label: "World",
    cpu: 0,
    peak: 0,
    values: { bodies: value },
  });
  a.samples = [
    { at: 510, systems: [system(-5)] },
    { at: 535, systems: [system(8)] },
    { at: 560, systems: [system(null)] },
    { at: 580, systems: [system("paused")] },
  ];
  a.systems = [system(99999)];
  b.systems = [system(99999)];
  const result = values(bundle, "counter", "bodies");
  expect(result.values.slice(0, 5).map((cell) => cell.value)).toEqual([null, -5, 8, null, null]);
  expect(result.values[1]?.age).toBe(10);
  expect(result.values[4]?.reason).toContain("not numeric");
  expect(values(bundle, "counter", "bodies", "B").values.every((cell) => cell.value === null)).toBe(
    true,
  );
});

test("missing intervals, incomplete pairs and invalid timing cannot produce lane measurements", () => {
  const bundle = comparisonFixture("low-window");
  const result = values(bundle, "cpu", "physics");
  const plot = comparisonLaneGeometry(result.points, result.values, result.duration, 0, 10);
  expect(plot.path.match(/M/g)?.length).toBeGreaterThan(1);
  expect(plot.missing).not.toBe("");
  const partial = comparisonFixture("stopped");
  const model = comparisonLanes(partial, 2);
  const source = model.sources[0],
    lane = model.lanes[0];
  if (!source || !lane) throw new Error("Missing side");
  expect(comparisonLaneValues(source, lane, [])).toEqual([]);
  expect(comparisonLaneGeometry([], [], 1000, 0, 10)).toMatchObject({
    path: "",
    missing: "M0,90H100V100H0Z",
  });
  const frame = bundle.trials[0]?.recording.frames[1];
  if (!frame) throw new Error("Missing frame");
  frame.interval = 80;
  expect(values(bundle, "cpu", "physics").values).toEqual([]);
});

test("lane scales retain signed extremes, constant zeroes and the full recorded path", () => {
  const points = comparisonFrames(comparisonFixture("same"), 1).series[0]?.points ?? [];
  const cell = (value: number): LaneValue => ({ value, status: "measured", reason: "Recorded" });
  const plot = comparisonLaneGeometry(
    points,
    points.map((_, index) => cell(index % 2 ? Number.MAX_VALUE : -Number.MAX_VALUE)),
    1000,
    -Number.MAX_VALUE,
    Number.MAX_VALUE,
  );
  expect(plot.path).not.toMatch(/NaN|Infinity/);
  expect(plot.path.match(/H/g)).toHaveLength(points.length);
  const zero = comparisonLaneGeometry(
    points,
    points.map(() => cell(0)),
    1000,
    0,
    0,
  );
  expect(zero.path).not.toBe("");
  expect(zero.missing).toBe("");
});
