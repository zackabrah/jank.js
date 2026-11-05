import { expect, test } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { parseRecording, serializeRecording } from "../recording/format.ts";
import { gpuFixture } from "./fixtures.ts";
import { gpuCoverage, gpuFrameCoverage, gpuFrameToLive, validateGpuFrame } from "./model.ts";

test("complete-empty and measured zero differ from missing, partial and unknown evidence", () => {
  const zero = gpuFixture();
  expect(gpuFrameToLive(zero, 4)).toMatchObject({
    timedWork: { status: "measured", value: 0 },
    ageFrames: 3,
  });
  const empty = { ...zero, invocations: [] };
  expect(gpuFrameCoverage(empty)).toMatchObject({
    completeness: "complete",
    expected: 0,
    timed: 0,
  });
  expect(gpuFrameCoverage({ ...zero, inventory: "unknown" })).toMatchObject({
    completeness: "unknown",
    expected: null,
  });
  expect(gpuFrameCoverage(gpuFixture(2, "pending"))).toMatchObject({
    completeness: "partial",
    pending: 1,
  });
  expect(gpuCoverage([1, 2, 3], [zero, gpuFixture(2, "rejected")])).toMatchObject({
    complete: 1,
    partial: 1,
    missing: 1,
  });
});

test("round-trips owned evidence and rejects corrupt or ambiguous records", () => {
  const recording = recordingFixture();
  const id = recording.frames[0]?.id ?? 1;
  const frame = gpuFixture(id);
  recording.gpuTiming = { version: 1, frames: [frame] };
  expect(parseRecording(serializeRecording(recording))).toEqual(recording);
  for (const next of [
    { ...frame, frameId: 99999 },
    { ...frame, clock: "cpu" },
    { ...frame, resolutionMs: 0 },
    { ...frame, invocations: [{ ...frame.invocations[0], state: "pending" }] },
    { ...frame, invocations: [...frame.invocations, ...frame.invocations] },
    { ...frame, invocations: [{ ...frame.invocations[0], startMs: 2, endMs: 1 }] },
  ])
    expect(() =>
      parseRecording(JSON.stringify({ ...recording, gpuTiming: { version: 1, frames: [next] } })),
    ).toThrow();
  expect(() =>
    parseRecording(
      JSON.stringify({ ...recording, gpuTiming: { version: 1, frames: [frame, frame] } }),
    ),
  ).toThrow("unique");
  expect(() => validateGpuFrame({ ...frame, omitted: Infinity })).toThrow();
  delete recording.gpuTiming;
  expect(parseRecording(serializeRecording(recording)).gpuTiming).toBeUndefined();
});
