import { expect, test } from "vitest";
import {
  createDiagnostics,
  parseRecording,
  recordingSummary,
  serializeRecording,
} from "./index.ts";
import { recordingFixture } from "./recording/fixtures.ts";
import { summarizeRecording } from "./recording/summary.ts";

/** Steady frames with a hitch, on a 16.667 ms budget and 0.1 ms timer, with optional GPU timing. */
function runAt(intervalMs: number, gpuMs: number | null) {
  const recording = recordingFixture(80);
  recording.budget.frameMs = 16.667;
  recording.metadata.environment.cpuTimer.estimatedResolutionMs = 0.1;
  let at = 0;
  recording.frames.forEach((frame, index) => {
    frame.interval = index === 40 ? 60 : intervalMs;
    at += frame.interval;
    frame.at = at;
    frame.update = 1;
    frame.render = 1;
    frame.scopes = [];
  });
  if (gpuMs === null) return recording;
  return {
    ...recording,
    gpuTiming: {
      version: 1 as const,
      frames: recording.frames.map((frame) => ({
        frameId: frame.id,
        source: "host" as const,
        clock: "gpu" as const,
        epoch: 0,
        resolutionMs: null,
        inventory: "complete" as const,
        omitted: 0,
        invocations: [
          {
            id: "0",
            label: "Scene",
            kind: "render" as const,
            state: "timed" as const,
            milliseconds: gpuMs,
            startMs: 0,
            endMs: gpuMs,
            reason: null,
          },
        ],
      })),
    },
  };
}

test("the public parser keeps the GPU evidence and capture context that panel exports carry", () => {
  const recording = recordingFixture(30);
  const gpuTiming = {
    version: 1 as const,
    frames: [
      {
        frameId: recording.frames[0]?.id ?? 0,
        source: "host" as const,
        clock: "gpu" as const,
        epoch: 0,
        resolutionMs: null,
        inventory: "complete" as const,
        invocations: [],
        omitted: 0,
      },
    ],
  };
  const parsed = parseRecording(serializeRecording({ ...recording, gpuTiming }));
  expect(parsed.gpuTiming?.frames).toHaveLength(1);
});

test("the public parser still reads what the collector exports", () => {
  const monitor = createDiagnostics();
  monitor.frame(performance.now(), 16, 1, 2);
  const parsed = parseRecording(serializeRecording(monitor.export()));
  expect(parsed.format).toBe("jank.js-recording");
  expect(parsed.frames).toHaveLength(1);
  monitor.dispose();
});

// JANK-006: a host reading the public count must get the number the panel and viewer show.
test.each([
  // A 57 Hz display sets the pace, so only the hitch is slow, not every frame.
  ["a display-paced run", 17.5, 2, 1],
  // The same frame time from heavy GPU work is really slow; the display is not excused.
  ["GPU work filling the frame", 17.5, 15, 80],
  // Without GPU timing a GPU-limited scene looks the same, so no pace is claimed.
  ["no GPU timing", 17.5, null, 80],
])("overBudgetFrames matches the viewer on %s", (_name, intervalMs, gpuMs, expected) => {
  const recording = runAt(intervalMs, gpuMs);
  expect(recordingSummary(recording).overBudgetFrames).toBe(expected);
  expect(recordingSummary(recording).overBudgetFrames).toBe(
    summarizeRecording(recording).overCount,
  );
});
