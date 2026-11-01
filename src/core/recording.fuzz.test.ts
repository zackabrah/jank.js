import fc from "fast-check";

import { describe, expect, it } from "vitest";

import { createDiagnostics } from "./diagnostics.ts";

import {
  RecordingFormatError,
  parseRecording,
  serializeRecording,
} from "./recording.ts";

import type { PerformanceRecording } from "./recording-types.ts";

/** How parseRecording ended for some text: the recording, or the error it threw. */
function attempt(text: string): PerformanceRecording | Error {
  try {
    return parseRecording(text);
  } catch (error) {
    // Anything thrown that isn't an Error fails the test right here.
    if (error instanceof Error) return error;

    throw error;
  }
}

/** A small, valid recording with frames, scopes, events and counters, as JSON-shaped data. */
function sample(): unknown {
  let now = 0;

  const monitor = createDiagnostics({ now: () => now });

  const physics = monitor.register("physics", "physics", () => ({
    bodies: 12,
    sleeping: true,
    solver: "pgs",
  }));

  monitor.startRecording();

  for (let i = 0; i < 4; i++) {
    monitor.beginFrame(now);

    const token = physics.begin();

    now += 2;

    physics.end(token);

    monitor.event(`step ${i}`, "detail");
    monitor.endFrame(2, 1);

    now += 14;
  }

  monitor.beginFrame(now);

  return JSON.parse(serializeRecording(monitor.export()));
}

/** Every path to a value inside some JSON data, as lists of keys and indexes. */
function paths(
  value: unknown,
  at: (string | number)[] = [],
): (string | number)[][] {
  if (Array.isArray(value))
    return [at, ...value.flatMap((item, i) => paths(item, [...at, i]))];

  if (value && typeof value === "object")
    return [
      at,
      ...Object.entries(value).flatMap(([key, item]) =>
        paths(item, [...at, key]),
      ),
    ];

  return [at];
}

/** A copy of the data with the value at a path replaced, or removed when `next` is undefined. */
function replaced(
  data: unknown,
  path: readonly (string | number)[],
  next: unknown,
): unknown {
  const [key, ...rest] = path;

  if (key === undefined) return next;

  const removing = !rest.length && next === undefined;

  if (Array.isArray(data)) {
    const copy: unknown[] = [...data];

    if (removing) copy.splice(Number(key), 1);
    else copy[Number(key)] = replaced(copy[Number(key)], rest, next);

    return copy;
  }

  if (!data || typeof data !== "object") return data;

  return Object.fromEntries(
    Object.entries(data).flatMap(([name, value]) => {
      if (name !== String(key)) return [[name, value]];

      return removing ? [] : [[name, replaced(value, rest, next)]];
    }),
  );
}

describe("recording parser under random input", () => {
  // What: any text at all, including any JSON document, either loads or is rejected with
  // RecordingFormatError. Nothing else may escape.
  // Why: the viewer opens files people drop on it. A TypeError or RangeError from deep inside
  // the parser would surface as a broken page instead of "this isn't a recording".
  it("loads or cleanly rejects any text", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: "binary" }), fc.json()),
        (text) => {
          const result = attempt(text);

          expect(
            !(result instanceof Error) ||
              result instanceof RecordingFormatError,
          ).toBe(true);
        },
      ),
    );
  });

  // What: a valid recording with any one value replaced by any JSON value, or removed,
  // either loads or is rejected with RecordingFormatError, and whatever loads saves and loads
  // again unchanged.
  // Why: random text is almost always rejected at the first check. Near-misses like a frame
  // interval that's a string, a missing field or a nested array where an object belongs are
  // what reach the deep validation, and a file that loads must survive the viewer's export.
  it("loads or cleanly rejects a valid recording with one value broken", () => {
    const valid = sample();

    fc.assert(
      fc.property(
        // The whole document is the first property's job; this one breaks values inside it.
        fc.constantFrom(...paths(valid).filter((path) => path.length)),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (path, next) => {
          const result = attempt(JSON.stringify(replaced(valid, path, next)));

          expect(
            !(result instanceof Error) ||
              result instanceof RecordingFormatError,
          ).toBe(true);

          // Whatever loads must save and load again unchanged.
          const saved =
            result instanceof Error ? null : serializeRecording(result);

          expect(
            saved === null ||
              serializeRecording(parseRecording(saved)) === saved,
          ).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});
