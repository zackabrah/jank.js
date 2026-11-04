import { expect, test } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { recordingFixture } from "../recording/fixtures.ts";
import {
  counterGeometry,
  frameEvidence,
  largestScopeChange,
  readCounter,
  recordingCounters,
  sampleAt,
  scopeMedians,
} from "./inspector-model.ts";
import { recordingLanes } from "./lanes.ts";

test("counter snapshots use the last sample at or before frame start, never latest untimed values", () => {
  const recording = recordingFixture();
  const system = (value: number | null) => ({
    id: "renderer",
    label: "Renderer",
    cpu: 0,
    peak: 0,
    values: { drawCalls: value },
  });
  recording.samples = [
    { at: 0, systems: [system(3)] },
    { at: 10, systems: [system(5)] },
    { at: 10, systems: [system(7)] },
    { at: 20, systems: [] },
    { at: 30, systems: [system(null)] },
    { at: 40, systems: [system(0)] },
  ];
  recording.systems = [system(999)];
  const model = recordingCounters(recording);
  const counter = model.counters[0];
  if (!counter) throw new Error("Missing counter");
  expect(sampleAt([], 0)).toBe(-1);
  expect(readCounter(model, counter, -1)).toMatchObject({
    value: undefined,
    age: null,
    delta: null,
  });
  expect(readCounter(model, counter, 9)).toMatchObject({ value: 3, age: 9, delta: null });
  expect(readCounter(model, counter, 10)).toMatchObject({ value: 7, age: 0, delta: 2 });
  expect(readCounter(model, counter, 22)).toMatchObject({
    value: undefined,
    age: null,
    delta: null,
  });
  expect(readCounter(model, counter, 35)).toMatchObject({ value: null, age: 5, delta: null });
  expect(readCounter(model, counter, 41)).toMatchObject({ value: 0, age: 1, delta: null });
});

test("counter identity includes its system and changed scalars do not become numeric deltas", () => {
  const recording = recordingFixture();
  const systems = (value: string | number) =>
    ["a", "b"].map((id) => ({ id, label: id, cpu: 0, peak: 0, values: { value } }));
  recording.samples = [
    { at: 0, systems: systems("before") },
    { at: 10, systems: systems("after") },
    { at: 20, systems: systems(-Number.MAX_VALUE) },
    { at: 30, systems: systems(Number.MAX_VALUE) },
  ];
  const model = recordingCounters(recording);
  expect(new Set(model.counters.map((counter) => counter.id)).size).toBe(2);
  const counter = model.counters[0];
  if (!counter) throw new Error("Missing counter");
  expect(readCounter(model, counter, 10)).toMatchObject({
    value: "after",
    changed: true,
    delta: null,
  });
  expect(readCounter(model, counter, 30).delta).toBeNull();
});

test("CPU medians include absent scopes as zero only in complete frames", () => {
  const recording = recordingFixture(5);
  recording.frames.forEach((frame, index) => {
    frame.scopes =
      index < 2 ? [{ system: "work", label: "Work", start: frame.at - 10, end: frame.at }] : [];
    if (index === 1) frame.coverage = "truncated";
  });
  const model = recordingLanes(recording);
  const medians = scopeMedians(recording, model);
  expect([...medians.values()]).toEqual([0]);
  expect(largestScopeChange(model, medians, 0)).toEqual({ label: "Work", delta: 10, median: 0 });
  expect(largestScopeChange(model, medians, 1)).toBeNull();
  recording.frames.forEach((frame) => {
    frame.coverage = "unavailable";
  });
  expect(scopeMedians(recording, recordingLanes(recording)).size).toBe(0);
});

test("counter paths keep zero and negative values, break at missing samples and stay finite", () => {
  const geometry = counterGeometry([-5, 0, null, 5], -5, 5);
  expect(geometry.line).toBe("M0,36H75V20H150M225,4H300");
  expect(geometry.missing).not.toBe("");
  expect(counterGeometry([0, 0], 0, 0).line).toBe("M0,20H150V20H300");
  expect(
    counterGeometry([-Number.MAX_VALUE, Number.MAX_VALUE], -Number.MAX_VALUE, Number.MAX_VALUE)
      .line,
  ).not.toMatch(/NaN|Infinity/);
});

test("frame evidence exports explicit GPU links and only eligible counter snapshots", () => {
  const recording = recordingFixture();
  const frame = recording.frames[1];
  if (!frame) throw new Error("Missing frame");
  const start = frame.at - frame.interval;
  recording.samples = [
    { at: start - 1, systems: [] },
    { at: start, systems: [] },
    { at: start + 1, systems: [] },
  ];
  recording.gpuTiming = {
    version: 1,
    frames: [gpuFixture(frame.id + 1), gpuFixture(frame.id, "rejected")],
  };
  const evidence = frameEvidence(recording, frame);
  expect(evidence.counters.sample?.at).toBe(start);
  expect(evidence.counters.previousSample?.at).toBe(start - 1);
  expect(evidence.gpuTiming?.frameId).toBe(frame.id);
  expect(evidence.gpuTiming?.invocations[0]?.state).toBe("rejected");
  expect(evidence.legacyGpu).toBeNull();
});
