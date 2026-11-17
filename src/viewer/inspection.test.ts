import { expect, test } from "vitest";
import { gpuFixture } from "../gpu/fixtures.ts";
import { recordingFixture } from "../recording/fixtures.ts";
import { inspectRecording } from "./inspection.ts";

test("ranks spikes by duration with stable ties, separately from chronological navigation and capture rules", () => {
  const recording = recordingFixture(5);
  recording.budget.frameMs = 10;
  recording.capture.thresholdMs = 100;
  [20, 45, 30, 45, 0].forEach((interval, index) => {
    const frame = recording.frames[index];
    if (frame) {
      frame.interval = interval;
      frame.id = 100 + index * 3;
    }
  });
  const summary = inspectRecording(recording);
  expect(summary.spikeThreshold).toBe(20);
  expect(summary.slowIndices).toEqual([1, 2, 3]);
  expect(summary.spikes.map((spike) => [spike.frame.id, spike.rank])).toEqual([
    [103, 1],
    [109, 2],
    [106, 3],
  ]);
  expect(inspectRecording(recordingFixture(0)).spikes).toEqual([]);
});

test("capture context counts retained records rather than subtracting gapped IDs; absent metadata stays absent", () => {
  const recording = recordingFixture(5);
  recording.frames.forEach((frame, index) => {
    frame.id = 10 + index * 10;
  });
  expect(inspectRecording(recording).window).toBeNull();
  recording.capture = {
    ...recording.capture,
    mode: "automatic",
    triggerFrame: 30,
    beforeFrames: 5,
    afterFrames: 4,
  };
  expect(inspectRecording(recording).window).toMatchObject({
    before: 2,
    after: 2,
    requestedBefore: 5,
    requestedAfter: 4,
    phases: [],
  });
  recording.capture.triggerFrame = null;
  expect(inspectRecording(recording).window).toMatchObject({ before: null, after: null });
});

test("coverage accounts for every frame and links only retained problem evidence", () => {
  const recording = recordingFixture(5);
  const empty = gpuFixture(5);
  empty.invocations = [];
  recording.gpuTiming = {
    version: 1,
    frames: [
      gpuFixture(1),
      gpuFixture(2, "rejected"),
      { ...gpuFixture(3), inventory: "unknown" },
      empty,
    ],
  };
  const summary = inspectRecording(recording);
  expect(summary.gpu).toMatchObject({ complete: 2, partial: 1, unknown: 1, missing: 1, total: 5 });
  expect(summary.gpuProblems.map((problem) => [problem.index, problem.record.frameId])).toEqual([
    [1, 2],
    [2, 3],
  ]);
  expect(summary.gpuProblems[0]?.record.invocations[0]?.reason).toBe("GPU counter reset");
  delete recording.gpuTiming;
  expect(inspectRecording(recording).gpuProblems).toEqual([]);
  expect(inspectRecording(recording).gpu.missing).toBe(5);
});
