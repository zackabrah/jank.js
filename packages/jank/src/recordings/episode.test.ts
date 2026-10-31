import { expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { parseRecording, serializeRecording } from "./codec.ts";
import { beginEpisode, coversTimeWindow, validateTimeWindow } from "./episode.ts";
import type { Recording } from "./recording.ts";

function fixture(): Recording {
  let atMs = 0;
  const frames = [10, 35, 10, 35, 10, 10].map((durationMs, index) => {
    const frame = {
      id: index + 1,
      startedAtMs: atMs,
      endedAtMs: atMs + durationMs,
      cpu: { updateMs: null, renderMs: null },
      scopes: [],
      coverage: { status: "complete" as const },
      overhead: { collectionMs: 0, refreshMs: 0 },
    };
    atMs += durationMs;
    return frame;
  });
  return {
    ...recordingFixture(),
    schemaVersion: 6,
    frames,
    channels: [],
    gpu: [],
    events: [],
    counters: [],
    capture: {
      kind: "automatic",
      triggerFrameId: 2,
      thresholdMs: 20,
      beforeFrames: 1,
      afterFrames: 4,
      episode: {
        timeWindow: { beforeMs: 10, afterMs: 20, recoveryMs: 20, maxDurationMs: 100 },
        triggerFrameIds: [2, 4],
        cooldownMs: 100,
        stopReason: "recovered",
      },
    },
  };
}
it("round trips the episode envelope without altering schema-5 files", () => {
  const source = fixture();
  expect(parseRecording(serializeRecording(source))).toEqual({ ok: true, recording: source });
  expect(parseRecording(serializeRecording(recordingFixture()))).toEqual({
    ok: true,
    recording: recordingFixture(),
  });
});
it("rejects invented or reordered trigger histories, invalid settings and misleading closure claims", () => {
  const source = fixture();
  if (source.capture.kind !== "automatic" || !source.capture.episode) {
    throw new Error("Missing episode");
  }
  const episode = source.capture.episode;
  const invalid = [
    { ...episode, triggerFrameIds: [] },
    { ...episode, triggerFrameIds: [2] },
    { ...episode, triggerFrameIds: [4, 2] },
    { ...episode, triggerFrameIds: [2, 3] },
    { ...episode, timeWindow: { ...episode.timeWindow, maxDurationMs: 1 } },
    { ...episode, timeWindow: { ...episode.timeWindow, beforeMs: -1 } },
    { ...episode, stopReason: "frame-capacity" },
    { ...episode, stopReason: "duration-limit" },
    { ...episode, stopReason: "manual-start" },
    { ...episode, timeWindow: { ...episode.timeWindow, recoveryMs: 50 } },
    { ...episode, stopReason: "disarmed", timeWindow: { ...episode.timeWindow, afterMs: 90 } },
    { ...episode, timeWindow: { ...episode.timeWindow, beforeMs: 100 } },
  ];
  for (const value of invalid) {
    expect(
      parseRecording(JSON.stringify({ ...source, capture: { ...source.capture, episode: value } }))
        .ok,
    ).toBe(false);
  }
  expect(parseRecording(JSON.stringify({ ...source, schemaVersion: 5 })).ok).toBe(false);
  expect(
    parseRecording(JSON.stringify({ ...source, capture: { ...source.capture, kind: "manual" } }))
      .ok,
  ).toBe(false);
  const capped = {
    ...source,
    truncated: true,
    capture: {
      ...source.capture,
      episode: {
        ...episode,
        stopReason: "duration-limit",
        timeWindow: { ...episode.timeWindow, maxDurationMs: 20 },
      },
    },
  };
  expect(parseRecording(JSON.stringify(capped)).ok).toBe(true);
  expect(parseRecording(JSON.stringify({ ...capped, truncated: false })).ok).toBe(false);
});
it("uses continuous retained intervals rather than elapsed gaps as context", () => {
  const frames = fixture().frames;
  expect(coversTimeWindow(frames, 0, 110)).toBe(true);
  expect(coversTimeWindow(frames, 110, 110)).toBe(true);
  expect(coversTimeWindow(frames, 0, 120)).toBe(false);
  expect(coversTimeWindow(frames.slice(1), 0, 100)).toBe(false);
  expect(
    coversTimeWindow(
      frames.filter((frame) => frame.id !== 3),
      0,
      100,
    ),
  ).toBe(false);
  const first = frames[0];
  if (!first) {
    throw new Error("Missing frame");
  }
  expect(
    beginEpisode({ beforeMs: 0, afterMs: 0, recoveryMs: 0, maxDurationMs: 1 }, first).stopReason,
  ).toBe("recovered");
  for (const value of [NaN, Infinity, -1, 600001]) {
    expect(() =>
      validateTimeWindow({ beforeMs: value, afterMs: 0, recoveryMs: 0, maxDurationMs: 1 }),
    ).toThrow();
  }
});
