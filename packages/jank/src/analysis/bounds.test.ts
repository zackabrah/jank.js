import { expect, it } from "vitest";
import { projectBounds } from "./bounds.ts";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const box = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5], culled: false } as const;
it("projects world AABB edges into normalized viewport coordinates using an explicit clip convention", () => {
  const lines = projectBounds(box, identity, "minus-one-to-one");
  expect(lines).toHaveLength(12);
  expect(lines[0]).toEqual([0.25, 0.75, 0.75, 0.75]);
  expect(
    projectBounds(
      { ...box, min: [-0.5, -0.5, -0.9], max: [0.5, 0.5, -0.1] },
      identity,
      "zero-to-one",
    ),
  ).toEqual([]);
});
it("clips crossing edges and rejects invalid, reversed and wholly outside bounds", () => {
  expect(
    projectBounds({ ...box, min: [-2, -0.5, 0], max: [0.5, 0.5, 2] }, identity, "zero-to-one")
      .flat()
      .every((value) => value >= 0 && value <= 1),
  ).toBe(true);
  for (const invalid of [[], identity.map(() => NaN)]) {
    expect(projectBounds(box, invalid, "zero-to-one")).toEqual([]);
  }
  expect(projectBounds({ ...box, min: [2, 2, 2] }, identity, "zero-to-one")).toEqual([]);
  expect(projectBounds({ ...box, min: [NaN, 0, 0] }, identity, "zero-to-one")).toEqual([]);
  expect(
    projectBounds({ ...box, min: [2, 2, 2], max: [3, 3, 3] }, identity, "zero-to-one"),
  ).toEqual([]);
  const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0];
  expect(
    projectBounds({ ...box, min: [-1, -1, 1], max: [1, 1, 2] }, perspective, "minus-one-to-one"),
  ).toEqual([]);
  const crossing = projectBounds(
    { ...box, min: [-0.2, -0.2, -2], max: [0.2, 0.2, 1] },
    perspective,
    "minus-one-to-one",
  );
  expect(crossing.length).toBeGreaterThan(0);
  expect(crossing.flat().every(Number.isFinite)).toBe(true);
});

it("keeps rotated offscreen edges finite and bounded, including numeric overflow", () => {
  for (let offset = -4; offset <= 4; offset += 0.2) {
    const rotated = [
      Math.SQRT1_2,
      Math.SQRT1_2,
      0,
      0,
      -Math.SQRT1_2,
      Math.SQRT1_2,
      0,
      0,
      0,
      0,
      1,
      0,
      offset,
      2,
      0,
      1,
    ];
    const edges = projectBounds(box, rotated, "minus-one-to-one");
    expect(edges.flat().every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(
      true,
    );
  }
  expect(
    projectBounds(
      { ...box, min: [2, 2, 2], max: [3, 3, 3] },
      identity.map(() => Number.MAX_VALUE),
      "zero-to-one",
    ),
  ).toEqual([]);
});
