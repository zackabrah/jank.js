import fc from "fast-check";

import { describe, expect, it } from "vitest";

import { createDiagnostics } from "./diagnostics.ts";

import {
  maxDetailLength,
  maxEvents,
  maxLabelLength,
  parseRecording,
  serializeRecording,
} from "./recording.ts";

const hostileNumber = fc.oneof(
  fc.double(),
  fc.constantFrom(
    0,
    -0,
    Number.NaN,
    Infinity,
    -Infinity,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
    -1e308,
    2 ** 53,
  ),
);

const hostileText = fc.oneof(
  fc.string({ unit: "binary", maxLength: 300 }),
  fc.constantFrom(
    "",
    " ",
    "‮right to left",
    "🎮".repeat(200),
    "a".repeat(10_000),
    "\u0000￿",
    "\uD800",
  ),
);

const command = fc.oneof(
  fc.record({
    kind: fc.constant("frame" as const),
    // Mostly a real step forward in time, sometimes a hostile timestamp.
    step: fc.oneof(
      { weight: 9, arbitrary: fc.double({ min: 0, max: 1000, noNaN: true }) },
      { weight: 1, arbitrary: hostileNumber },
    ),
    update: hostileNumber,
    render: hostileNumber,
  }),
  fc.record({
    kind: fc.constant("scope" as const),
    system: fc.nat({ max: 2 }),
    ms: fc.double({ min: 0, max: 50, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant("event" as const),
    label: hostileText,
    detail: hostileText,
  }),
  fc.record({
    kind: fc.constant("counter" as const),
    key: hostileText,
    value: fc.oneof(hostileNumber, hostileText, fc.boolean()),
  }),
  fc.record({ kind: fc.constant("fps" as const), value: hostileNumber }),
  fc.record({
    kind: fc.constantFrom(
      "start" as const,
      "stop" as const,
      "arm" as const,
      "disarm" as const,
      "clear" as const,
      "expand" as const,
      "collapse" as const,
    ),
  }),
);

/** What a call threw, or null when it returned. */
function thrown(call: () => void): unknown {
  try {
    call();

    return null;
  } catch (error) {
    return error;
  }
}

/** True for a recorded time or cost: finite and not negative. */
const valid = (value: number) => Number.isFinite(value) && value >= 0;

describe("monitor under random use", () => {
  // What: any sequence of hostile calls (NaN, ±Infinity, 1e308 and -0 for times and costs;
  // empty, 10,000-character, emoji, right-to-left and broken-surrogate labels; recording,
  // capture and target changes at random) only ever throws the documented RangeError. Every
  // frame, scope, event and counter it keeps is a valid number or a bounded string, and the
  // export loads in the viewer.
  // Why: the monitor runs inside someone else's game loop. It must never take the game down
  // over a bad value, never show NaN in the panel, and never write a recording the viewer
  // then refuses.
  it("keeps valid data and a loadable recording whatever the host does", () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 80 }), (commands) => {
        let now = 0;

        // Errors other than the documented RangeError for a bad timestamp or target.
        const undocumented: unknown[] = [];

        // A Map, so a fuzzed key such as "__proto__" stays an ordinary counter name.
        const counters = new Map<string, number | string | boolean>();

        const monitor = createDiagnostics({ now: () => now });

        const systems = [0, 1, 2].map((i) =>
          monitor.register(`system ${i}`, `system ${i}`, () =>
            Object.fromEntries(counters),
          ),
        );

        for (const next of commands) {
          if (next.kind === "frame") {
            if (Number.isFinite(next.step) && next.step >= 0) now += next.step;

            const at =
              Number.isFinite(next.step) && next.step >= 0 ? now : next.step;

            undocumented.push(thrown(() => monitor.beginFrame(at)));

            monitor.endFrame(next.update, next.render);
          } else if (next.kind === "scope") {
            const token = systems[next.system]!.begin();

            now += next.ms;

            systems[next.system]!.end(token);
          } else if (next.kind === "event")
            monitor.event(next.label, next.detail);
          else if (next.kind === "counter") counters.set(next.key, next.value);
          else if (next.kind === "fps") {
            undocumented.push(thrown(() => monitor.setTargetFps(next.value)));
          } else if (next.kind === "start") monitor.startRecording();
          else if (next.kind === "stop") monitor.stopRecording();
          else if (next.kind === "arm") monitor.armCapture();
          else if (next.kind === "disarm") monitor.disarmCapture();
          else if (next.kind === "clear") monitor.clear();
          else monitor.setExpanded(next.kind === "expand");
        }

        expect(
          undocumented.filter(
            (error) => error !== null && !(error instanceof RangeError),
          ),
        ).toEqual([]);

        monitor.beginFrame(now + 16);

        const snapshot = monitor.snapshot();

        for (const frame of snapshot.frames) {
          expect(
            [frame.interval, frame.update, frame.render].every(valid),
          ).toBe(true);

          for (const scope of frame.scopes)
            expect(
              Number.isFinite(scope.start) &&
                Number.isFinite(scope.end) &&
                scope.start <= scope.end,
            ).toBe(true);
        }

        expect(snapshot.events.length).toBeLessThanOrEqual(maxEvents);

        for (const event of snapshot.events) {
          expect(Number.isFinite(event.at)).toBe(true);
          expect(event.label.length).toBeLessThanOrEqual(maxLabelLength);
          expect(event.detail.length).toBeLessThanOrEqual(maxDetailLength);
        }

        for (const system of snapshot.systems)
          for (const value of Object.values(system.values))
            expect(
              value === null ||
                typeof value === "boolean" ||
                typeof value === "string" ||
                Number.isFinite(value),
            ).toBe(true);

        const saved = serializeRecording(monitor.export());

        expect(() => parseRecording(saved)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
