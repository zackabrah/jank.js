import { expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import {
  buildCounterTimeline,
  counterAtTime,
  counterCatalog,
  counterScale,
} from "./counter-timeline.ts";

it("pins numeric identities by configured provider order then first-seen keys, including B-only fields", () => {
  const base = recordingFixture();
  const a = {
    ...base,
    channels: [{ id: "render", label: "Renderer" }, ...base.channels],
    counters: [
      {
        atMs: 110,
        channelId: "physics",
        status: "ready" as const,
        values: { bodies: 0, state: "ready", enabled: true },
      },
      {
        atMs: 111,
        channelId: "render",
        status: "ready" as const,
        values: { drawCalls: 3, triangles: 90 },
      },
    ],
  };
  const b = {
    ...a,
    counters: [
      {
        atMs: 112,
        channelId: "render",
        status: "ready" as const,
        values: { textures: 12, drawCalls: 2 },
      },
    ],
  };
  expect(counterCatalog(a, b).map((identity) => [identity.channelId, identity.name])).toEqual([
    ["render", "drawCalls"],
    ["render", "triangles"],
    ["render", "textures"],
    ["physics", "bodies"],
  ]);
  expect(
    counterCatalog(a, { ...b, channels: [{ id: "render", label: "Changed B label" }] })[0]?.label,
  ).toBe("Renderer · drawCalls");
  expect(counterCatalog(null, null)).toEqual([]);
});

it("keeps actual sample times, zero and signed values, with explicit age and no interpolation", () => {
  const base = recordingFixture();
  const recording = {
    ...base,
    counters: [
      { atMs: 110, channelId: "physics", status: "ready" as const, values: { bodies: 0 } },
      { atMs: 120, channelId: "physics", status: "ready" as const, values: { bodies: -4 } },
    ],
  };
  const model = buildCounterTimeline(recording, counterCatalog(recording, null), {
    fromMs: 15,
    toMs: 25,
  });
  const lane = model.lanes[0];
  if (!lane) {
    throw new Error("Missing counter");
  }
  expect(lane.points.map((point) => [point.elapsedMs, point.value])).toEqual([
    [10, 0],
    [20, -4],
  ]);
  expect(counterAtTime(lane, 5)).toMatchObject({ value: null, ageMs: null });
  expect(counterAtTime(lane, 17)).toMatchObject({ value: 0, ageMs: 7, elapsedMs: 10 });
  expect(counterAtTime(lane, 20)).toMatchObject({ value: -4, ageMs: 0 });
  expect(counterScale(lane, undefined, model.window)).toEqual({ minimum: -4, maximum: 0 });
});

it("null, missing fields, type changes, provider errors and duplicate timestamps invalidate old values", () => {
  const base = recordingFixture();
  const recording = {
    ...base,
    counters: [
      { atMs: 100, channelId: "physics", status: "ready" as const, values: { bodies: 3 } },
      { atMs: 104, channelId: "physics", status: "ready" as const, values: { bodies: null } },
      { atMs: 108, channelId: "physics", status: "ready" as const, values: {} },
      { atMs: 112, channelId: "physics", status: "ready" as const, values: { bodies: "3" } },
      { atMs: 116, channelId: "physics", status: "error" as const, message: "Unavailable" },
      { atMs: 120, channelId: "physics", status: "ready" as const, values: { bodies: 7 } },
      { atMs: 120, channelId: "physics", status: "ready" as const, values: { bodies: 8 } },
      { atMs: 124, channelId: "physics", status: "ready" as const, values: { bodies: 9 } },
    ],
  };
  const model = buildCounterTimeline(recording, counterCatalog(recording, null), {
    fromMs: 0,
    toMs: 32,
  });
  const lane = model.lanes[0];
  if (!lane) {
    throw new Error("Missing counter");
  }
  expect([5, 9, 13, 17, 21].map((time) => counterAtTime(lane, time).value)).toEqual([
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(counterAtTime(lane, 17).note).toContain("Unavailable");
  expect(counterAtTime(lane, 21).note).toContain("Ambiguous");
  expect(counterAtTime(lane, 25)).toMatchObject({ value: 9, ageMs: 1 });
  expect(counterAtTime(lane, 33)).toMatchObject({
    value: null,
    ageMs: null,
    note: "Outside recorded time range",
  });
  const reversed = buildCounterTimeline(
    { ...recording, counters: [...recording.counters].reverse() },
    counterCatalog(recording, null),
    { fromMs: 0, toMs: 32 },
  );
  expect(reversed.lanes[0]?.points).toEqual(lane.points);
});

it("aligns independent CPU origins and shares each counter's scale across A/B without mixing keys", () => {
  const a = recordingFixture();
  const b = {
    ...a,
    frames: a.frames.map((frame) => ({
      ...frame,
      startedAtMs: frame.startedAtMs + 5000,
      endedAtMs: frame.endedAtMs + 5000,
    })),
    counters: [
      { atMs: 5110, channelId: "physics", status: "ready" as const, values: { bodies: 30 } },
    ],
  };
  const catalog = counterCatalog(a, b);
  const window = { fromMs: 0, toMs: 32 };
  const left = buildCounterTimeline(a, catalog, window);
  const right = buildCounterTimeline(b, catalog, window);
  const lane = left.lanes[0];
  if (!lane) {
    throw new Error("Missing counter");
  }
  expect(right.lanes[0]?.points[0]?.elapsedMs).toBe(10);
  expect(counterScale(lane, right.lanes[0], window)).toEqual({ minimum: 0, maximum: 30 });
  expect(buildCounterTimeline(null, catalog, window).lanes[0]?.points).toEqual([]);
});

it("reports changes from the previous valid sample without hiding invalid polls or overflow", () => {
  const lane = {
    identity: { channelId: "cpu", name: "count", label: "Count" },
    endsAtMs: 50,
    points: [
      { elapsedMs: 0, value: 10, note: "Observed" },
      { elapsedMs: 10, value: null, note: "Provider error" },
      { elapsedMs: 20, value: 0, note: "Observed" },
      { elapsedMs: 30, value: -Number.MAX_VALUE, note: "Observed" },
      { elapsedMs: 40, value: Number.MAX_VALUE, note: "Observed" },
    ],
  };
  expect(counterAtTime(lane, 0).change).toMatchObject({
    value: null,
    note: "No previous valid sample",
  });
  expect(counterAtTime(lane, 10).change).toMatchObject({
    value: null,
    note: "Current sample unavailable",
  });
  expect(counterAtTime(lane, 25).change).toEqual({
    value: -10,
    previousElapsedMs: 0,
    intervalMs: 20,
    skippedSamples: 1,
    note: "1 invalid poll(s) skipped",
  });
  expect(counterAtTime(lane, 30).change).toMatchObject({
    value: -Number.MAX_VALUE,
    skippedSamples: 0,
  });
  expect(counterAtTime(lane, 40).change).toMatchObject({
    value: null,
    note: "Change exceeds numeric range",
  });
});
