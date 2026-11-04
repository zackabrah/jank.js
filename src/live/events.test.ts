import { expect, test } from "vitest";
import { eventPosition, readEvents } from "./events.ts";
import { liveFixture } from "./fixtures.ts";
import { readLive } from "./model.ts";

test("event timestamps retain millisecond precision after 100 seconds", () => {
  const events = readEvents(
    [99999, 100123, 100456, 3600125].map((at) => ({ at, label: "Event", detail: "" })),
    [],
  );
  expect(events?.map(eventPosition)).toEqual([
    "99.999\u00a0s · no matching frame",
    "100.123\u00a0s · no matching frame",
    "100.456\u00a0s · no matching frame",
    "3600.125\u00a0s · no matching frame",
  ]);
});

test("assigns events to actual intervals, preserving gaps, boundaries and fractional clocks", () => {
  const frames = [
    { id: 10, at: 10, interval: 10 },
    { id: 11, at: 20, interval: 10 },
    { id: 12, at: 20, interval: 0 },
    { id: 13, at: 40, interval: 10 },
  ];
  const events = [-1, 0, 9, 10, 20, 25, 30, 39, 40, 42].map((at) => ({
    at,
    label: "Event",
    detail: "",
  }));
  const result = readEvents(events, frames);
  expect(result?.map((event) => event.frameId)).toEqual([
    null,
    10,
    10,
    11,
    null,
    null,
    13,
    13,
    null,
    null,
  ]);
  expect(result?.at(-1)?.age).toBeNull();
  expect(result?.[1]?.age).toBe(0.04);
  const fractional = readEvents(
    [{ at: 0.1, label: "Boundary", detail: "" }],
    [
      { id: 1, at: 0.1, interval: 0.1 },
      { id: 2, at: 0.1 + 0.2, interval: 0.2 },
    ],
  );
  expect(fractional?.[0]?.frameId).toBe(2);
  expect(
    readEvents(events, [])?.every((event) => event.frameId === null && event.age === null),
  ).toBe(true);
});

test("keeps bounded owned event records and stable identities, including identical duplicates", () => {
  const source = liveFixture();
  const before = { at: 1, label: "Before", detail: "" };
  const duplicate = { at: 1000, label: "Same", detail: "Repeated" };
  const events = [before, duplicate, { ...duplicate }];
  source.diagnostics.events = events;
  const original = readLive(source);
  source.diagnostics.events = events.slice(1);
  const shifted = readLive(source);
  expect(shifted.events?.map((event) => event.id)).toEqual(
    original.events?.slice(1).map((event) => event.id),
  );
  expect(new Set(shifted.events?.map((event) => event.id)).size).toBe(2);
  duplicate.label = "Changed by host";
  expect(original.events?.[1]?.label).toBe("Same");
  source.diagnostics.events = Array.from({ length: 205 }, (_, at) => ({
    at,
    label: "Repeated",
    detail: "",
  }));
  expect(readLive(source).events).toHaveLength(200);
  expect(readLive(source).events?.[0]?.at).toBe(5);
  source.diagnostics.events = [{ at: 800, label: "Later", detail: "" }, before];
  expect(readLive(source).events?.map((event) => event.at)).toEqual([1, 800]);
});

test("distinguishes absent events from empty history and rejects invalid supplied values", () => {
  expect(readEvents(undefined, [])).toBeNull();
  expect(readEvents([], [])).toEqual([]);
  for (const event of [
    { at: NaN, label: "Invalid", detail: "" },
    { at: Infinity, label: "Invalid", detail: "" },
    { at: 1, label: "x".repeat(241), detail: "" },
    { at: 1, label: "Valid", detail: "x".repeat(2001) },
  ])
    expect(() => readEvents([event], [])).toThrow(RangeError);
});
