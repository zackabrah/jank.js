import { expect, it, vi } from "vitest";

import { createDiagnostics } from "./diagnostics.ts";

import { parseRecording, MAX_RECORDING_BYTES } from "./recording.ts";

import { createDevToolsSink } from "./devtools.ts";

it("accepts dense captures within the per-frame and file-size limits", () => {
  const monitor = createDiagnostics(() => 0);

  monitor.frame(20, 20, 1, 1);

  const recording = monitor.export(),
    template = recording.frames[0]!;

  recording.frames = Array.from({ length: 800 }, (_, index) => ({
    ...template,
    id: index + 1,
    at: (index + 1) * 20,
    scopes: Array.from({ length: 256 }, () => ({
      system: "x",
      label: "X",
      start: index * 20,
      end: index * 20 + 1,
    })),
  }));

  expect(parseRecording(JSON.stringify(recording)).frames).toHaveLength(800);
});

it("rejects malformed, future, oversized and out-of-frame recordings", () => {
  const monitor = createDiagnostics(() => 0);

  monitor.frame(20, 20, 1, 1);

  const recording = monitor.export();

  expect(() => parseRecording("not json")).toThrow("not valid JSON");

  expect(() => parseRecording(" ".repeat(MAX_RECORDING_BYTES + 1))).toThrow(
    "32 MiB",
  );

  expect(() =>
    parseRecording(JSON.stringify({ ...recording, version: 999 })),
  ).toThrow("version");

  expect(() =>
    parseRecording(
      JSON.stringify({
        ...recording,
        frames: [{ ...recording.frames[0], interval: -1 }],
      }),
    ),
  ).toThrow("interval");

  expect(() =>
    parseRecording(
      JSON.stringify({
        ...recording,
        frames: [
          {
            ...recording.frames[0],
            scopes: [{ system: "a", label: "A", start: 0, end: 100 }],
          },
        ],
      }),
    ),
  ).toThrow("scope.end");

  expect(() =>
    parseRecording(
      JSON.stringify({
        ...recording,
        frames: [recording.frames[0], recording.frames[0]],
      }),
    ),
  ).toThrow("IDs");
});

it("imports v1 without inventing environment, exact attribution or overhead evidence", () => {
  const legacy = {
    format: "world-performance-recording",
    version: 1,
    units: "milliseconds",
    frameCapacity: 6000,
    frames: [{ at: 20, interval: 20, update: 1, render: 2 }],
    samples: [],
    systems: [],
    events: [],
  };

  const recording = parseRecording(JSON.stringify(legacy));

  expect(() =>
    parseRecording(JSON.stringify({ ...legacy, format: "jank.js-recording" })),
  ).toThrow("format/version");

  expect(recording.format).toBe("jank.js-recording");

  expect(recording.metadata.importedFromVersion).toBe(1);

  expect(
    recording.metadata.environment.cpuTimer.estimatedResolutionMs,
  ).toBeNull();

  expect(recording.frames[0]?.coverage).toBe("unavailable");

  expect(recording.overhead.frames).toBe(0);
});

it("emits only opt-in scopes/markers and clears only its own timing entries", () => {
  const timeline = {
    measure: vi.fn<Performance["measure"]>(),
    mark: vi.fn<Performance["mark"]>(),
    clearMeasures: vi.fn<Performance["clearMeasures"]>(),
    clearMarks: vi.fn<Performance["clearMarks"]>(),
  };

  const sink = createDevToolsSink({ enabled: false, performance: timeline });

  sink.scope("a", "A", 1, 2);

  expect(timeline.measure).not.toHaveBeenCalled();

  sink.setEnabled(true);

  sink.scope("a", "A", 1, 2);

  sink.marker("Loaded", "Ready", 3);

  expect(timeline.measure.mock.calls[0]?.[1]).toMatchObject({
    start: 1,
    end: 2,
    detail: { devtools: { track: "A", trackGroup: "jank.js" } },
  });

  expect(timeline.clearMeasures).toHaveBeenCalledWith(
    timeline.measure.mock.calls[0]?.[0],
  );

  sink.dispose();

  sink.marker("Ignored", "", 4);

  expect(timeline.mark).toHaveBeenCalledTimes(1);
});
