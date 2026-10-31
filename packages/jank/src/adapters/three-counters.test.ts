import { expect, it } from "vitest";
import { readThreeRendererCounters } from "./three-counters.ts";

it("reads WebGL draw submissions without resetting or mutating renderer-owned info", () => {
  const info = {
    render: { calls: 12, triangles: 240, points: 0, lines: 4 },
    memory: { geometries: 2, textures: 3 },
  };
  expect(readThreeRendererCounters(info, "webgl")).toEqual({
    drawCalls: 12,
    triangles: 240,
    points: 0,
    lines: 4,
    geometries: 2,
    textures: 3,
  });
  expect(info.render.calls).toBe(12);
  info.render.calls = 20;
  expect(readThreeRendererCounters(info, "webgl").drawCalls).toBe(20);
});
it("uses WebGPU drawCalls, never cumulative render.calls, and preserves unavailable counters", () => {
  expect(
    readThreeRendererCounters(
      {
        render: { calls: 999, drawCalls: 7, triangles: NaN, points: -1 },
        memory: { textures: Infinity },
      },
      "webgpu",
    ),
  ).toEqual({
    drawCalls: 7,
    triangles: null,
    points: null,
    lines: null,
    geometries: null,
    textures: null,
  });
  expect(readThreeRendererCounters(null, "webgl").drawCalls).toBeNull();
  expect(readThreeRendererCounters({ render: { calls: 999 } }, "webgpu").drawCalls).toBeNull();
  expect(readThreeRendererCounters({}, "webgl").textures).toBeNull();
});
