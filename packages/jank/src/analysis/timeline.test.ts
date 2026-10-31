import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { workCatalog } from "./frame-comparison.ts";
import { buildTimeline, fitTimelineWindow, zoomTimelineWindow } from "./timeline.ts";

it("retains lane order, missing samples, exact event placement and partial measurements", () => {
  const base = recordingFixture();
  const gpu = gpuIntervalFixture();
  const recording = {
    ...base,
    gpu: [gpu],
    frames: base.frames.map((frame, index) =>
      index
        ? { ...frame, scopes: [], coverage: { status: "not-collected" as const } }
        : { ...frame, coverage: { status: "truncated" as const, omittedScopes: 1 } },
    ),
  };
  const catalog = workCatalog(recording, null);
  const model = buildTimeline(recording, catalog, { fromMs: 0, toMs: 32 });
  expect(model.lanes.map((lane) => lane.identity.label)).toEqual(catalog.map((lane) => lane.label));
  expect(model.lanes[0]?.samples[0]).toMatchObject({
    frameId: 1,
    fromMs: 0,
    toMs: 16,
    durationMs: 4,
    comparable: false,
  });
  expect(model.lanes[0]?.samples[1]?.durationMs).toBeNull();
  expect(model.lanes[1]?.samples.map((sample) => sample.durationMs)).toEqual([4, null]);
  expect(model.events).toEqual([{ elapsedMs: 20, label: "Loaded", detail: null }]);
  const cropped = buildTimeline(recording, catalog, { fromMs: 16, toMs: 20 });
  expect(cropped.lanes.length).toBe(model.lanes.length);
  expect(cropped.events).toEqual([]);
  expect(cropped.lanes[1]?.samples[0]).toMatchObject({ frameId: 2, durationMs: null });
});

it("keeps zero measurements distinct from gaps, rejects ambiguous GPU evidence and ignores unlinked GPU samples", () => {
  const base = recordingFixture();
  const sample = base.gpu[0];
  if (!sample) {
    throw new Error("Missing sample");
  }
  const recording = {
    ...base,
    frames: base.frames.map((frame) => ({
      ...frame,
      scopes: frame.scopes.map((scope) => ({ ...scope, endedAtMs: scope.startedAtMs })),
    })),
    gpu: [sample, sample, { ...sample, frameId: null }],
  };
  const model = buildTimeline(recording, workCatalog(recording, null), { fromMs: 0, toMs: 32 });
  expect(model.lanes[0]?.samples[0]?.durationMs).toBe(0);
  expect(model.lanes[1]?.samples[0]?.note).toBe("Multiple GPU observations");
  expect(
    buildTimeline(null, workCatalog(recording, null), { fromMs: 0, toMs: 32 }).lanes.every(
      (lane) => lane.samples.length === 0,
    ),
  ).toBe(true);
  expect(buildTimeline({ ...base, frames: [] }, [], { fromMs: 0, toMs: 32 }).frames).toEqual([]);
});

it("bounds pan and zoom, preserves the zoom anchor and includes boundary-crossing frames", () => {
  expect(fitTimelineWindow(900, 250, 1000)).toEqual({ fromMs: 750, toMs: 1000 });
  expect(fitTimelineWindow(-20, 5000, 1000)).toEqual({ fromMs: 0, toMs: 1000 });
  expect(fitTimelineWindow(0, 0, 0)).toEqual({ fromMs: 0, toMs: 1 });
  expect(
    zoomTimelineWindow({ fromMs: 0, toMs: 1000 }, { anchorMs: 750, factor: 0.5, totalMs: 1000 }),
  ).toEqual({ fromMs: 375, toMs: 875 });
  expect(
    zoomTimelineWindow({ fromMs: 0, toMs: 1000 }, { anchorMs: -50, factor: 0.5, totalMs: 1000 }),
  ).toEqual({ fromMs: 0, toMs: 500 });
  const base = recordingFixture();
  expect(
    buildTimeline(base, workCatalog(base, null), { fromMs: 10, toMs: 20 }).frames.map(
      (frame) => frame.id,
    ),
  ).toEqual([1, 2]);
});
