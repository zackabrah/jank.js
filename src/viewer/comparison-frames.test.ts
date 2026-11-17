import { expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import { comparisonFrameAt, comparisonFrames, comparisonMarkers } from "./comparison-frames.ts";

test("aligns distinct clocks and frame IDs by elapsed intervals, including unequal trial lengths", () => {
  const bundle = comparisonFixture();
  const b = bundle.trials[1];
  if (!b) throw new Error("Missing B trial");
  b.measurementStartMs += 123456;
  b.measurementEndMs += 123456;
  b.recording.frames.forEach((frame, index) => {
    frame.at += 123456;
    frame.id = 1001 + index * 3;
  });
  const chart = comparisonFrames(bundle, 1);
  expect(chart.series.map((series) => series.points[0]?.start)).toEqual([0, 0]);
  expect(comparisonFrameAt(chart, "A", 30)).toMatchObject({ id: 2, start: 20, end: 40, value: 20 });
  expect(comparisonFrameAt(chart, "B", 30)).toMatchObject({
    id: 1004,
    start: 22,
    end: 44,
    value: 22,
  });
  expect(comparisonFrameAt(chart, "A", 1005)).toBeNull();
  expect(comparisonFrameAt(chart, "A", 1000)).toBeNull();
  expect(comparisonFrameAt(chart, "B", 1005)?.value).toBe(22);
  expect(chart.duration).toBe(1012);
  expect(comparisonFrameAt(chart, "B", chart.duration)?.id).toBe(b.recording.frames.at(-1)?.id);
  expect(comparisonFrames(bundle, 2).series.map((series) => series.points[0]?.value)).toEqual([
    20, 18,
  ]);
});

test("breaks the path at missing intervals and never fills their readout", () => {
  const chart = comparisonFrames(comparisonFixture("low-window"), 1);
  expect(comparisonFrameAt(chart, "A", 0)?.value).toBe(20);
  expect(comparisonFrameAt(chart, "A", 20)).toBeNull();
  expect(comparisonFrameAt(chart, "A", 30)).toBeNull();
  expect(comparisonFrameAt(chart, "A", 40)?.value).toBe(20);
  expect(chart.series[0]?.path.match(/M/g)?.length).toBeGreaterThan(1);
});

test("retains a completed side of a partial pair and exposes the missing side", () => {
  const bundle = comparisonFixture("stopped");
  const chart = comparisonFrames(bundle, 2);
  expect(chart.series[0]).toMatchObject({
    key: "A",
    path: "",
    points: [],
    reason: "Trial 2A was not completed.",
  });
  expect(comparisonFrameAt(chart, "A", 0)).toBeNull();
  expect(comparisonFrameAt(chart, "B", 0)?.value).toBe(18);
  bundle.trials = [];
  const empty = comparisonFrames(bundle, 1);
  expect(empty.duration).toBe(bundle.plan.measureMs);
  expect(empty.series.every((series) => series.path === "" && series.reason)).toBe(true);
});

test("does not draw ambiguous overlapping frame intervals as valid data", () => {
  const bundle = comparisonFixture();
  const frame = bundle.trials[0]?.recording.frames[1];
  if (!frame) throw new Error("Missing frame");
  frame.interval = 30;
  const chart = comparisonFrames(bundle, 1);
  expect(chart.series[0]?.reason).toContain("overlapping or out-of-window");
  expect(chart.series[0]?.path).toBe("");
  expect(comparisonFrameAt(chart, "A", 25)).toBeNull();
  expect(comparisonFrameAt(chart, "B", 25)?.value).toBe(22);
});

test("uses one padded domain including budget and both variants, with finite extreme geometry", () => {
  const bundle = comparisonFixture();
  const chart = comparisonFrames(bundle, 1);
  expect(chart.lower).toBeGreaterThan(0);
  expect(chart.lower).toBeLessThan(bundle.budgetMs);
  expect(chart.upper).toBeGreaterThan(22);
  for (const series of chart.series)
    for (const point of series.points) {
      expect(chart.y(point.value)).toBeGreaterThanOrEqual(0);
      expect(chart.y(point.value)).toBeLessThanOrEqual(100);
    }
  const trial = bundle.trials[0];
  const frame = trial?.recording.frames[0];
  if (!trial || !frame) throw new Error("Missing trial");
  trial.measurementStartMs = 0;
  trial.measurementEndMs = Number.MAX_VALUE;
  trial.recording.frames = [{ ...frame, interval: Number.MAX_VALUE, at: Number.MAX_VALUE }];
  const extreme = comparisonFrames(bundle, 1);
  expect(extreme.ticks.every(Number.isFinite)).toBe(true);
  expect(extreme.series.map((series) => series.path).join("")).not.toMatch(/NaN|Infinity/);
});

test("bounds decorative markers while retaining every frame and spike in dense recordings", () => {
  const bundle = comparisonFixture();
  const trial = bundle.trials[0];
  const frame = trial?.recording.frames[0];
  if (!trial || !frame) throw new Error("Missing trial");
  let at = trial.measurementStartMs;
  trial.recording.frames = Array.from({ length: 6000 }, (_, index) => {
    const interval = index === 3171 ? 200 : 1;
    at += interval;
    return { ...frame, id: index + 1, at, interval };
  });
  trial.measurementEndMs = at;
  const chart = comparisonFrames(bundle, 1);
  const points = chart.series[0]?.points ?? [];
  const full = comparisonMarkers(points, { start: 0, end: chart.duration });
  expect(full.length).toBeLessThanOrEqual(24);
  // A zoomed window re-spaces markers instead of keeping only the sparse full-run stride.
  const zoomed = comparisonMarkers(points, { start: 3000, end: 3060 });
  expect(zoomed.length).toBeGreaterThan(5);
  expect(zoomed.length).toBeLessThanOrEqual(24);
  for (const point of zoomed) expect(point.end >= 3000 && point.start <= 3060).toBe(true);
  expect(chart.series[0]?.path.match(/H/g)).toHaveLength(6000);
  expect(comparisonFrameAt(chart, "A", 3172)?.value).toBe(200);
  expect(chart.upper).toBeGreaterThan(200);
});
