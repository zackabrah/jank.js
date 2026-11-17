// biome-ignore-all lint/complexity/useLiteralKeys: TypeScript requires bracket access for diagnostic records.
import type { WebGLRenderer } from "three";
import Info from "three/src/renderers/common/Info.js";
import { expect, test, vi } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { parseRecording, serializeRecording } from "../recording/format.ts";
import { readThreeCounters } from "./three-counters.ts";

test("normalizes WebGL counters without resetting the host or inventing unsupported values", () => {
  const info: WebGLRenderer["info"] = {
    autoReset: false,
    render: { frame: 999, calls: 8, triangles: 240, lines: 40, points: 0 },
    memory: { geometries: 2, textures: 0 },
    programs: [],
    reset: vi.fn(),
    update: vi.fn(),
  };
  const result = readThreeCounters(info);
  expect(result).toMatchObject({
    backend: "webgl2",
    drawCalls: 8,
    triangles: 240,
    lines: 40,
    points: 0,
    geometries: 2,
    textures: 0,
    programs: 0,
    shaderStages: null,
    renderCalls: null,
    computeCalls: null,
    trackedStorageEstimateBytes: null,
    attributes: null,
    readbackBuffersEstimateBytes: null,
  });
  info.render.calls = 0;
  info.memory.geometries = 3;
  expect(result["drawCalls"]).toBe(8);
  expect(result["geometries"]).toBe(2);
  expect(info.reset).not.toHaveBeenCalled();
  expect(info.autoReset).toBe(false);
});

test("reads WebGPU per-frame calls separately from lifetime totals and retains resources across resets", () => {
  const info = new Info();
  info.autoReset = false;
  Object.assign(info.render, {
    calls: 1000,
    frameCalls: 8,
    drawCalls: 12,
    triangles: 900,
    lines: 40,
  });
  Object.assign(info.compute, { calls: 300, frameCalls: 2 });
  Object.assign(info.memory, {
    geometries: 3,
    textures: 2,
    programs: 6,
    total: 8192,
    texturesSize: 4096,
    attributes: 4,
    attributesSize: 2048,
    uniformBuffers: 2,
    uniformBuffersSize: 512,
  });
  expect(readThreeCounters(info)).toMatchObject({
    backend: "webgpu",
    drawCalls: 12,
    renderCalls: 8,
    computeCalls: 2,
    programs: null,
    shaderStages: 6,
    geometries: 3,
    textures: 2,
    trackedStorageEstimateBytes: 8192,
    textureStorageEstimateBytes: 4096,
    attributes: 4,
    attributesEstimateBytes: 2048,
    uniformBuffers: 2,
    uniformBuffersEstimateBytes: 512,
  });
  expect(info.render.calls).toBe(1000);
  expect(info.autoReset).toBe(false);
  info.reset();
  expect(readThreeCounters(info)).toMatchObject({
    drawCalls: 0,
    renderCalls: 0,
    computeCalls: 0,
    triangles: 0,
    lines: 0,
    geometries: 3,
    trackedStorageEstimateBytes: 8192,
  });
  info.memory.total = NaN;
  info.render.drawCalls = -1;
  expect(readThreeCounters(info)).toMatchObject({
    drawCalls: null,
    trackedStorageEstimateBytes: null,
  });
});

test("counter samples round-trip raw units, frame identity, booleans and unavailable fields", () => {
  const recording = recordingFixture();
  const frame = recording.frames.at(-1);
  if (!frame) throw new Error("Missing fixture frame");
  const system = {
    id: "submission",
    label: "Render submission",
    cpu: 0,
    peak: 0,
    values: { frameId: frame.id, ...readThreeCounters(new Info()), workloadPaused: true },
  };
  recording.systems = [system];
  recording.samples = [{ at: frame.at, systems: [system] }];
  const loaded = parseRecording(serializeRecording(recording));
  expect(loaded.systems).toEqual([system]);
  expect(loaded.samples).toEqual(recording.samples);
  expect(loaded.samples[0]?.systems[0]?.values["programs"]).toBeNull();
  expect(loaded.samples[0]?.systems[0]?.values["computeCalls"]).toBe(0);
});
