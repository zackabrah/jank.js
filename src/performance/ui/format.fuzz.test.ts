import fc from "fast-check";

import { describe, expect, it } from "vitest";

import { eventGlyph } from "../../core/inspection.ts";

import { axisStep, counter, duration, shorten } from "./format.ts";

describe("panel text under random input", () => {
  // What: any frame or scope duration from zero to eleven days reads in the largest unit
  // that fits, with at most three digits before ns or µs.
  // Why: the panel and viewer print these next to each other. "1000 µs" beside "1.0 ms"
  // reads as two different sizes for the same time, and rounding is where that slips in.
  it("prints any duration in its largest fitting unit", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: 0, max: 1e9, noNaN: true }),
          // Just under 1 µs and 1 ms, where rounding can carry into the next unit.
          fc.double({ min: 0.000_99, max: 0.001_01, noNaN: true }),
          fc.double({ min: 0.99, max: 1.01, noNaN: true }),
        ),
        (ms) => {
          expect(duration(ms)).toMatch(/^(\d{1,3} (ns|µs)|\d+\.\d ms)$/);
        },
      ),
    );
  });

  // What: any counter value that survives collection (a finite number, boolean or null)
  // prints without NaN or Infinity and in at most 12 characters.
  // Why: hosts report whatever their engine counts, from 0 to byte totals in the trillions.
  // The value column holds about 12 characters; a longer number pushes the row past the
  // panel's edge or hides its label.
  it("prints any counter value within the panel's value column", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
        ),
        (value) => {
          const text = counter(value);

          expect(text).not.toMatch(/NaN|Infinity|undefined/);
          expect(text.length).toBeLessThanOrEqual(12);
        },
      ),
    );
  });

  // What: shorten never returns more characters than asked for, returns a prefix of the text,
  // and cuts only between words.
  // Why: event and scope labels are shortened to fit the graph. A cut mid-word reads as a
  // different word, and an overlong result overlaps the label beside it.
  it("shortens any text to whole words within the limit", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary", maxLength: 300 }),
        fc.integer({ min: -5, max: 400 }),
        (text, characters) => {
          const result = shorten(text, characters);

          expect(result.length).toBeLessThanOrEqual(Math.max(0, characters));
          expect(text.startsWith(result)).toBe(true);

          // Either the whole text, nothing, or a cut that falls on a space.
          expect(
            result === text || result === "" || text[result.length] === " ",
          ).toBe(true);
        },
      ),
    );
  });

  // What: for any span from a microsecond to thirty years of milliseconds, the axis step is a
  // positive finite number that splits the span into at most three steps.
  // Why: the viewer's axes and the LOADING timeline label their ticks with this step. Zero,
  // NaN or a tiny step would draw thousands of ticks; a huge one would draw none.
  it("divides any span into at most three positive steps", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-6, max: 1e12, noNaN: true }),
        (longest) => {
          const step = axisStep(longest);

          expect(Number.isFinite(step) && step > 0).toBe(true);
          expect(longest / step).toBeLessThanOrEqual(3 + 1e-9);
        },
      ),
    );
  });

  // What: any label, including broken surrogates and control characters, gets exactly one
  // icon, keeps its text, and gets the same answer every time.
  // Why: the icon is drawn wherever events appear; a missing or doubled icon breaks the
  // event row's spacing, and a changing one would make a single event look like two.
  it("gives any label one stable icon", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), (label) => {
        const { glyph, text } = eventGlyph(label);

        expect(String.fromCodePoint(glyph.codePointAt(0)!)).toBe(glyph);
        expect(label.endsWith(text)).toBe(true);
        expect(eventGlyph(label)).toEqual({ glyph, text });
      }),
    );
  });
});
