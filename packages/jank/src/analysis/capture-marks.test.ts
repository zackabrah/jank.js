import { describe, expect, it } from "vitest";
import { viewerReferenceFixture } from "../../../../tests/fixtures/viewer-reference.ts";
import { findCaptureMarks } from "./capture-marks.ts";

describe("offline capture marks", () => {
  it("ranks separated spikes by duration and keeps chronological ties stable", () => {
    const marks = findCaptureMarks(viewerReferenceFixture());
    expect(marks.map((mark) => [mark.rank, mark.frameId, mark.source])).toEqual([
      [1, 243, "detected"],
      [2, 168, "detected"],
      [3, 336, "detected"],
    ]);
    expect(marks[0]?.nearbyEvents).toContain("wave 3");
  });
  it("groups nearby spikes, applies a strict two-budget threshold, and bounds the list", () => {
    const source = viewerReferenceFixture();
    const frames = Array.from({ length: 6000 }, (_, index) => ({
      ...source.frames[0],
      id: index + 1,
      startedAtMs: index * 100,
      endedAtMs: index * 100 + (index % 12 === 0 ? 50 : 1000 / 30),
      cpu: { updateMs: null, renderMs: null },
      scopes: [],
      coverage: { status: "not-collected" as const },
      overhead: { collectionMs: 0, refreshMs: 0 },
    }));
    expect(findCaptureMarks({ ...source, frames, events: [] })).toHaveLength(50);
    const nearby = frames.slice(0, 3).map((frame, index) => ({
      ...frame,
      endedAtMs: frame.startedAtMs + ([50, 70, 60][index] ?? 0),
    }));
    expect(
      findCaptureMarks({ ...source, frames: nearby, events: [] }).map((mark) => mark.frameId),
    ).toEqual([2]);
    expect(findCaptureMarks({ ...source, frames: [], events: [] })).toEqual([]);
  });
  it("uses only the recorded automatic trigger, even when another frame is slower", () => {
    const source = viewerReferenceFixture();
    const marks = findCaptureMarks({
      ...source,
      capture: {
        kind: "automatic",
        triggerFrameId: 168,
        thresholdMs: 40,
        beforeFrames: 167,
        afterFrames: 192,
      },
    });
    expect(marks.map((mark) => [mark.frameId, mark.source])).toEqual([[168, "recorded"]]);
  });
});

it("missing recordings have no captures and event context excludes unrelated times", () => {
  expect(findCaptureMarks(null)).toEqual([]);
  const base = viewerReferenceFixture();
  const recording = {
    ...base,
    events: [
      { atMs: 0, label: "Before capture context", detail: null },
      ...base.events,
      { atMs: 100000, label: "After recording", detail: null },
    ],
  };
  const marks = findCaptureMarks(recording);
  expect(
    marks.every(
      (mark) =>
        !mark.nearbyEvents.includes("capture context") &&
        !mark.nearbyEvents.includes("After recording"),
    ),
  ).toBe(true);
});
