import { expect, test } from "vitest";
import {
  comparisonWindow,
  fitComparisonRange,
  minimumComparisonRange,
  panComparisonRange,
  selectComparisonRange,
  zoomComparisonRange,
} from "./comparison-range.ts";

test("elapsed ranges preserve fractional boundaries, reverse brushes and clamp the cursor", () => {
  const full = fitComparisonRange(1012, 708.4);
  expect(selectComparisonRange(full, 800.25, 100.125, 1012)).toEqual({
    start: 100.125,
    end: 800.25,
    at: 708.4,
  });
  expect(selectComparisonRange(full, 400, 500, 1012)).toEqual({ start: 400, end: 500, at: 500 });
  expect(selectComparisonRange(full, -20, 2000, 1012)).toEqual(full);
  const collapsed = selectComparisonRange(full, 1012, 1012, 1012);
  expect(collapsed).toEqual({ start: 1011, end: 1012, at: 1011 });
});

test("panning preserves width, clamps at both ends and only moves an excluded cursor", () => {
  const state = { start: 250, end: 750, at: 500 };
  expect(panComparisonRange(state, 100, 1000)).toEqual({ start: 350, end: 850, at: 500 });
  expect(panComparisonRange(state, 900, 1000)).toEqual({ start: 500, end: 1000, at: 500 });
  expect(panComparisonRange({ ...state, at: 700 }, -900, 1000)).toEqual({
    start: 0,
    end: 500,
    at: 500,
  });
});

test("zoom stays centred on the cursor where possible and preserves finite nonzero windows", () => {
  expect(zoomComparisonRange(fitComparisonRange(1000, 400), 0.5, 1000)).toEqual({
    start: 150,
    end: 650,
    at: 400,
  });
  for (const duration of [0.5, 1, 1012, 100143, Number.MAX_VALUE]) {
    for (const at of [0, duration / 2, duration]) {
      let state = fitComparisonRange(duration, at);
      for (let i = 0; i < 40; i++) state = zoomComparisonRange(state, 0.5, duration);
      expect(state.at).toBe(at);
      expect(state.start).toBeGreaterThanOrEqual(0);
      expect(state.end).toBeLessThanOrEqual(duration);
      expect(state.end - state.start).toBeGreaterThan(0);
      expect((state.end - state.start) / minimumComparisonRange(duration)).toBeCloseTo(1, 5);
      expect(comparisonWindow(state, duration).viewBox).not.toMatch(/NaN|Infinity/);
      for (let i = 0; i < 40; i++) state = zoomComparisonRange(state, 2, duration);
      expect(state).toEqual(fitComparisonRange(duration, at));
    }
  }
});

test("all track coordinates map the same elapsed range without changing the underlying data", () => {
  const window = comparisonWindow({ start: 250, end: 750 }, 1000);
  expect(window.viewBox).toBe("25 0 50 100");
  expect(window.position(250)).toBe(0);
  expect(window.position(500)).toBe(50);
  expect(window.position(750)).toBe(100);
  expect(window.position(100)).toBeLessThan(0);
});
