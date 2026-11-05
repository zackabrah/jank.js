import { expect, test } from "vitest";
import { displayPace } from "./display-pace.ts";

const BUDGET = 1000 / 60;

test.each([
  ["57 Hz", 17.6, 2.4, 18.6],
  ["60 Hz", 16.7, 5, 17.7],
  ["144 Hz", 6.9, 3, 17.67],
])("a light scene on a %s display is paced", (_, typicalMs, workMs, limitMs) => {
  const pace = displayPace(BUDGET, typicalMs, workMs);
  expect(pace?.typicalMs).toBe(typicalMs);
  expect(pace?.limitMs).toBeCloseTo(limitMs, 2);
});

test("heavy work at the display's frame time isn't excused", () => {
  expect(displayPace(BUDGET, 17.6, 15)).toBeNull();
});

test("work over a budget tighter than the display isn't excused", () => {
  expect(displayPace(1000 / 120, BUDGET, 12)).toBeNull();
});

test("no claim without GPU timing, or with no frames", () => {
  expect(displayPace(BUDGET, 17.6, null)).toBeNull();
  expect(displayPace(BUDGET, 0, 0)).toBeNull();
});
