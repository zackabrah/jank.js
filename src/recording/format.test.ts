import { expect, test } from "vitest";
import { recordingFixture } from "./fixtures.ts";
import { MAX_RECORDING_BYTES, parseRecording, serializeRecording } from "./format.ts";

test("round trips current recordings with owned values and accepts legacy files without inventing coverage", () => {
  const recording = recordingFixture();
  const loaded = parseRecording(serializeRecording(recording));
  expect(loaded).toEqual(recording);
  expect(loaded.frames).not.toBe(recording.frames);
  const legacy = parseRecording(
    JSON.stringify({ ...recording, format: "world-performance-recording", version: 1 }),
  );
  expect(legacy.frames[0]?.coverage).toBe("unavailable");
  expect(legacy.metadata.environment.cpuTimer.estimatedResolutionMs).toBeNull();
});

test("rejects malformed, oversized, future and corrupt recording data", () => {
  const base = recordingFixture();
  expect(() => parseRecording("not json")).toThrow("not valid JSON");
  expect(() => parseRecording(" ".repeat(MAX_RECORDING_BYTES + 1))).toThrow("32 MiB");
  for (const version of [0, 3])
    expect(() => parseRecording(JSON.stringify({ ...base, version }))).toThrow("version");
  expect(() => parseRecording(JSON.stringify({ ...base, units: "seconds" }))).toThrow("units");
  expect(() =>
    parseRecording(JSON.stringify({ ...base, budget: { targetFps: 60, frameMs: 1 } })),
  ).toThrow("budget");
  expect(() =>
    parseRecording(JSON.stringify({ ...base, frames: [base.frames[0], base.frames[0]] })),
  ).toThrow("IDs");
  expect(() =>
    parseRecording(JSON.stringify({ ...base, frames: [{ ...base.frames[0], interval: -1 }] })),
  ).toThrow("interval");
  expect(() =>
    parseRecording(
      JSON.stringify({
        ...base,
        frames: [{ ...base.frames[0], scopes: [{ system: "a", label: "A", start: 0, end: 100 }] }],
      }),
    ),
  ).toThrow("scope.end");
  expect(() =>
    parseRecording(
      JSON.stringify({
        ...base,
        gpu: { units: "milliseconds", measurement: "test", latest: {}, samples: [] },
      }),
    ),
  ).toThrow("gpu.available");
});
