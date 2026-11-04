import { expect, test } from "vitest";
import { createDiagnostics, parseRecording, serializeRecording } from "./index.ts";
import { recordingFixture } from "./recording/fixtures.ts";

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
