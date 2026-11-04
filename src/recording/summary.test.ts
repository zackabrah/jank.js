import { expect, test } from "vitest";
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
