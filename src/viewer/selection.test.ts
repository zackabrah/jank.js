import { expect, test } from "vitest";
import { fitSelection, selectFrame, selectRange, zoomSelection } from "./selection.ts";

test("navigation reveals off-screen selections without changing the zoom width", () => {
  const state = { selected: 50, start: 40, end: 59 };
  expect(selectFrame(state, 75, 100)).toEqual({ selected: 75, start: 56, end: 75 });
  expect(selectFrame(state, -10, 100)).toEqual({ selected: 0, start: 0, end: 19 });
  expect(selectFrame(state, 150, 100)).toEqual({ selected: 99, start: 80, end: 99 });
  expect(selectFrame(state, 51, 100)).toEqual({ ...state, selected: 51 });
});

test("reverse brushes normalize, clamp selection and support a single-frame range", () => {
  const state = fitSelection(100, 50);
  expect(selectRange(state, 80, 20, 100)).toEqual({ selected: 50, start: 20, end: 80 });
  expect(selectRange(state, 10, 20, 100)).toEqual({ selected: 20, start: 10, end: 20 });
  expect(selectRange(state, 65, 65, 100)).toEqual({ selected: 65, start: 65, end: 65 });
  expect(selectRange(state, -5, 200, 100)).toEqual(state);
});

test("repeated zoom and Fit retain the selection at boundaries and the recording limit", () => {
  for (const count of [0, 1, 2, 99, 6000]) {
    for (const selected of [0, Math.floor(count / 2), Math.max(0, count - 1)]) {
      let state = fitSelection(count, selected);
      for (let i = 0; i < 15; i++) state = zoomSelection(state, 0.5, count);
      expect(state).toEqual({ selected, start: selected, end: selected });
      for (let i = 0; i < 15; i++) state = zoomSelection(state, 2, count);
      expect(state).toEqual(fitSelection(count, selected));
    }
  }
});
