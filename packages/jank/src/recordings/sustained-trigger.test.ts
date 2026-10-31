import { expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import type { FrameSample } from "../core/frames.ts";
import { parseRecording, serializeRecording } from "./codec.ts";
import type { Recording } from "./recording.ts";
import { SustainedTriggerDetector } from "./sustained-trigger.ts";

const sample = (id: number, start: number, duration: number): FrameSample => ({
  ...recordingFixture().frames[0],
  id,
  startedAtMs: start,
  endedAtMs: start + duration,
  cpu: { updateMs: null, renderMs: null },
  scopes: [],
  coverage: { status: "complete" },
  overhead: { collectionMs: 0, refreshMs: 0 },
});

it("resets sustained evidence across gaps, budget changes and explicit lifecycle boundaries", () => {
  const detector = new SustainedTriggerDetector();
  expect(detector.observe(sample(1, 0, 40), 100, 20)).toBeNull();
  expect(detector.observe(sample(2, 50, 40), 100, 20)).toBeNull();
  expect(detector.observe(sample(3, 90, 40), 100, 30)).toBeNull();
  expect(detector.observe(sample(4, 130, 40), 100, 30)).toBeNull();
  expect(detector.observe(sample(5, 170, 40), 100, 30)).toMatchObject({
    firstFrameId: 3,
    frameCount: 3,
  });
  detector.reset();
  expect(detector.observe(sample(6, 210, 40), 100, 30)).toBeNull();
  expect(detector.observe(sample(7, 250, 30), 100, 30)).toBeNull();
  expect(detector.observe(sample(8, 280, 110), 100, 30)).toMatchObject({
    firstFrameId: 8,
    frameCount: 1,
  });
});

function recording(): Recording {
  return {
    ...recordingFixture(),
    schemaVersion: 7,
    channels: [],
    gpu: [],
    counters: [],
    events: [],
    frames: [sample(1, 0, 40), sample(2, 40, 40), sample(3, 80, 40)],
    capture: {
      kind: "automatic",
      triggerFrameId: 3,
      thresholdMs: 20,
      beforeFrames: 2,
      afterFrames: 0,
      sustained: { durationMs: 100, startedAtMs: 0, firstFrameId: 1, frameCount: 3 },
    },
  };
}

it("validates sustained onset, continuous over-budget evidence and schema identity", () => {
  const source = recording();
  expect(parseRecording(serializeRecording(source))).toMatchObject({ ok: true, recording: source });
  if (source.capture.kind !== "automatic") {
    throw new Error("Missing trigger");
  }
  for (const change of [
    { durationMs: 140 },
    { durationMs: 70 },
    { firstFrameId: 2 },
    { frameCount: 2 },
    { startedAtMs: 1 },
    { durationMs: 0 },
  ]) {
    expect(
      parseRecording(
        JSON.stringify({
          ...source,
          capture: { ...source.capture, sustained: { ...source.capture.sustained, ...change } },
        }),
      ).ok,
    ).toBe(false);
  }
  for (const change of [
    { schemaVersion: 6 },
    { capture: { ...source.capture, kind: "manual" } },
    { frames: [sample(1, 0, 40), sample(2, 45, 35), sample(3, 80, 40)] },
    { frames: [sample(1, 0, 60), sample(2, 60, 20), sample(3, 80, 40)] },
  ]) {
    expect(parseRecording(JSON.stringify({ ...source, ...change })).ok).toBe(false);
  }
});

it("requires explicit truncation when the sustained onset has left retained context", () => {
  const source = recording();
  const partial = { ...source, frames: source.frames.slice(1), truncated: true };
  expect(parseRecording(serializeRecording(partial)).ok).toBe(true);
  expect(parseRecording(JSON.stringify({ ...partial, truncated: false })).ok).toBe(false);
  if (source.capture.kind !== "automatic") {
    throw new Error("Missing trigger");
  }
  expect(
    parseRecording(
      JSON.stringify({
        ...partial,
        capture: { ...source.capture, sustained: { ...source.capture.sustained, frameCount: 2 } },
      }),
    ).ok,
  ).toBe(false);
});
