import { describe, expect, test } from "vitest";
import { recordingFixture } from "./fixtures.ts";
import { summarizeRecording } from "./summary.ts";

test("summarizes the recording duration without including time before it started", () => {
  const recording = recordingFixture();
  for (const frame of recording.frames) frame.at += 10_000;
  recording.capture.triggerFrame = 3;
  expect(summarizeRecording(recording)).toMatchObject({
    durationMs: 74,
    worst: { id: 2, interval: 42 },
    initialIndex: 2,
    complete: 3,
    overCount: 1,
  });
  expect(summarizeRecording(recordingFixture(0))).toMatchObject({
    durationMs: 0,
    worst: null,
    p95: null,
  });
});

describe("GPU coverage when no frame declares its inventory", () => {
  const frameRecord = (frameId: number, inventory: "complete" | "unknown") => ({
    frameId,
    source: "webgl2" as const,
    clock: "gpu" as const,
    epoch: 0,
    resolutionMs: null,
    inventory,
    omitted: 0,
    invocations: [],
  });
  const labelFor = (inventories: ("complete" | "unknown" | null)[]) => {
    const recording = recordingFixture(inventories.length);
    const frames = recording.frames.flatMap((frame, index) => {
      const inventory = inventories[index];
      return inventory ? [frameRecord(frame.id, inventory)] : [];
    });
    return summarizeRecording({ ...recording, gpuTiming: { version: 1, frames } }).gpuLabel;
  };

  // What: a source that never declares its inventory reads unknown, not "0/3 complete".
  // Why: issue #8. WebGL2 and WebGPU sources default to an unknown inventory while giving valid
  // timings, so a zero reads as a failure when it only means the host made no claim.
  test.each([
    ["every frame unknown", ["unknown", "unknown", "unknown"], "unknown"],
    ["unknown frames beside lost records", ["unknown", null, "unknown"], "unknown"],
    // A declared inventory makes the count meaningful, so these keep it.
    ["some frames complete", ["complete", "unknown", "unknown"], "1/3 complete"],
    // Missing records are a real gap in a source that did record: still a zero, not unknown.
    ["every record lost", [null, null, null], "0/3 complete"],
  ] as const)("%s", (_name, inventories, expected) => {
    expect(labelFor([...inventories])).toBe(expected);
  });
});
