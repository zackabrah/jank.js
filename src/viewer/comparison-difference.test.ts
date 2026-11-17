import { expect, test } from "vitest";
import { comparisonDifference } from "./comparison-difference.ts";
import type { LaneValue } from "./lanes.ts";

function series(
  cells: { start: number; end: number; value: number | null; status?: LaneValue["status"] }[],
) {
  return {
    points: cells.map((cell, index) => ({
      start: cell.start,
      end: cell.end,
      index,
      id: index * 3 + 100,
      value: cell.end - cell.start,
    })),
    values: cells.map(
      (cell): LaneValue => ({
        value: cell.value,
        status: cell.status ?? "measured",
        reason: cell.status ?? "Recorded",
      }),
    ),
  };
}

test("differences split at both frame boundaries without ordinal pairing or interpolation", () => {
  const a = series([
    { start: 0, end: 20, value: 10 },
    { start: 20, end: 50, value: 5 },
  ]);
  const b = series([
    { start: 0, end: 10, value: 6 },
    { start: 10, end: 30, value: 15 },
    { start: 30, end: 50, value: 5 },
  ]);
  const delta = comparisonDifference(a, b, 50);
  expect(delta.points).toEqual([
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 30 },
    { start: 30, end: 50 },
  ]);
  expect(delta.values.map((cell) => cell.value)).toEqual([-4, 5, 10, 0]);
  expect(delta.extent).toBe(10);
  expect(delta.geometry.y(0)).toBe(50);
  expect(delta.geometry.y(-10)).toBe(100);
  expect(delta.geometry.y(10)).toBe(0);
  expect(delta.geometry.missing).toBe("");
});

test("only measured pairs yield differences; zero is known and partial CPU/GPU failures stay gaps", () => {
  const states = [
    "measured",
    "partial",
    "missing",
    "unknown",
    "pending",
    "rejected",
    "omitted",
    "absent",
    "measured",
  ] as const;
  const a = series(
    states.map((status, index) => ({
      start: index,
      end: index + 1,
      value: status === "measured" || status === "partial" ? 0 : null,
      status,
    })),
  );
  const b = series([{ start: 0, end: states.length, value: 0 }]);
  for (const delta of [
    comparisonDifference(a, b, states.length),
    comparisonDifference(b, a, states.length),
  ]) {
    expect(delta.values.map((cell) => cell.value)).toEqual([
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
    ]);
    expect(delta.values[1]?.reason).toContain("partial");
    expect(delta.known).toBe(true);
    expect(delta.geometry.path.match(/M/g)).toHaveLength(2);
    expect(delta.geometry.missing).not.toBe("");
  }
});

test("nonoverlapping intervals, incomplete trials and unequal tails never produce zero-filled data", () => {
  const a = series([
    { start: 0, end: 10, value: 1 },
    { start: 30, end: 50, value: 2 },
  ]);
  const b = series([{ start: 5, end: 40, value: 3 }]);
  const delta = comparisonDifference(a, b, 60);
  expect(delta.points).toEqual([
    { start: 5, end: 10 },
    { start: 30, end: 40 },
  ]);
  expect(delta.values.map((cell) => cell.value)).toEqual([2, 1]);
  expect(delta.geometry.path.match(/M/g)).toHaveLength(2);
  expect(delta.geometry.missing.match(/M/g)).toHaveLength(3);
  const empty = comparisonDifference(a, series([]), 60);
  expect(empty.known).toBe(false);
  expect(empty.geometry).toMatchObject({ path: "", missing: "M0,90H100V100H0Z" });
});

test("signed counter extremes keep finite geometry and overflowing subtraction remains unavailable", () => {
  const a = series([
    { start: 0, end: 10, value: -Number.MAX_VALUE },
    { start: 10, end: 20, value: 0 },
  ]);
  const b = series([
    { start: 0, end: 10, value: Number.MAX_VALUE },
    { start: 10, end: 20, value: Number.MAX_VALUE },
  ]);
  const delta = comparisonDifference(a, b, 20);
  expect(delta.values[0]).toMatchObject({
    value: null,
    reason: "Difference exceeds the numeric range.",
  });
  expect(delta.values[1]?.value).toBe(Number.MAX_VALUE);
  expect(delta.geometry.path).not.toMatch(/NaN|Infinity/);
  expect(delta.geometry.y(0)).toBe(50);
});

test("dense comparisons retain narrow spikes while bounding segments by both frame counts", () => {
  const a = series(
    Array.from({ length: 6000 }, (_, index) => ({
      start: index,
      end: index + 1,
      value: index === 3171 ? 200 : 1,
    })),
  );
  const b = series([{ start: 0, end: 6000, value: 1 }]);
  const delta = comparisonDifference(a, b, 6000);
  expect(delta.points).toHaveLength(6000);
  expect(delta.values[3171]?.value).toBe(-199);
  expect(delta.geometry.path.match(/H/g)).toHaveLength(6000);
});
