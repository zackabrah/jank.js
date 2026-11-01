import fc from "fast-check";

import { expect, test, type Page } from "@playwright/test";

import { serveFixtures } from "./fixture.ts";

declare global {
  interface Window {
    extremes: {
      feed(input: object): void;

      redraw(): void;
    };
  }
}

// Pieces of hostile text: emoji, right-to-left and zero-width marks, a combining accent, CJK,
// Arabic ligatures and wide letters. None spells NaN, Infinity or undefined, so those words
// on screen can only come from the panel itself.
const piece = fc.constantFrom(
  "🎮",
  "‮",
  "​",
  "W",
  "ﷺ",
  "𝕏",
  "a",
  " ",
  "-",
  "Ω",
  "́",
  "長",
);

const text = fc
  .array(piece, { maxLength: 400 })
  .map((pieces) => pieces.join(""));

const time = fc.oneof(
  fc.double({ min: 0.01, max: 1e7, noNaN: true }),
  fc.constantFrom(0.01, 16.7, 9_999_999),
);

const scenario = fc.record({
  frames: fc.array(fc.record({ interval: time, work: time }), {
    minLength: 2,
    maxLength: 120,
  }),
  events: fc.array(
    fc.record({ frame: fc.nat({ max: 119 }), label: text, detail: text }),
    { maxLength: 30 },
  ),
  counters: fc.dictionary(
    text,
    fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      text,
      fc.boolean(),
    ),
    { maxKeys: 8 },
  ),
});

/** What's broken right now: elements showing past the panel's edges, and NaN-like text. */
function problems(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".jank")!;

    const panel = root.getBoundingClientRect();

    /** An element's visible span, after every clipping ancestor inside the panel. */
    const visible = (element: Element) => {
      let { left, right } = element.getBoundingClientRect();

      for (
        let at = element.parentElement;
        at && at !== root;
        at = at.parentElement
      )
        if (getComputedStyle(at).overflowX !== "visible") {
          const clip = at.getBoundingClientRect();

          left = Math.max(left, clip.left);

          right = Math.min(right, clip.right);
        }

      return { left, right };
    };

    const overflow = [...root.querySelectorAll("*")]
      .filter((element) => {
        const { left, right } = visible(element);

        return (
          right > left && (right > panel.right + 1 || left < panel.left - 1)
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${element.className} ${(element.textContent ?? "").slice(0, 30)}`,
      );

    return {
      overflow: overflow.slice(0, 5),
      readout:
        /NaN|Infinity|undefined/.exec(root.textContent ?? "")?.[0] ?? null,
    };
  });
}

// What: random scenarios push extremes through a real panel: frames from 0.01 ms to nearly
// three hours, up to 120 frames, up to 30 events and 8 counters whose names and values
// mix emoji, right-to-left and zero-width marks, combining accents and 400-character
// runs, and counter values up to ±1.8e308. After each one, every tab and every size is
// checked for anything showing past the panel's edges, NaN-like text and page errors.
// Why: the panel lives inside someone else's game. Whatever that game measures or names,
// the panel must stay inside its box, readable and alive. Unit tests can't see layout.
test("the panel keeps its shape and its readouts under extreme input", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));

  await serveFixtures(page);

  // Each scenario starts at the full size; the panel would otherwise reopen in the size the
  // previous scenario shrank it to.
  await page.addInitScript(() => localStorage.clear());

  let runs = 0;

  await fc.assert(
    fc.asyncProperty(scenario, async (input) => {
      runs++;

      await page.goto("/__fixture/extremes.html");

      await page.waitForFunction(() => window.extremes !== undefined);

      await page.evaluate((value) => window.extremes.feed(value), input);

      const states: {
        state: string;
        overflow: string[];
        readout: string | null;
      }[] = [];

      // Each step changes what the panel shows, so they run one after another.
      /* oxlint-disable no-await-in-loop */
      for (const view of ["live", "loading", "capture"]) {
        await page
          .locator(`.jank-tab[data-tab="${view}"]`)
          .click({ timeout: 5000 });

        await page.evaluate(() => window.extremes.redraw());

        states.push({ state: view, ...(await problems(page)) });
      }

      for (const size of ["full-shrink", "mini-shrink"]) {
        await page.locator(`[data-action="${size}"]`).click({ timeout: 5000 });

        await page.evaluate(() => window.extremes.redraw());

        states.push({ state: size, ...(await problems(page)) });
      }
      /* oxlint-enable no-await-in-loop */

      expect({
        broken: states.filter(
          (state) => state.overflow.length || state.readout,
        ),
        errors,
      }).toEqual({ broken: [], errors: [] });
    }),
    // Running out of time fails the test rather than passing on fewer scenarios.
    {
      numRuns: 12,
      interruptAfterTimeLimit: 120_000,
      markInterruptAsFailure: true,
    },
  );

  expect(runs).toBeGreaterThanOrEqual(12);
});
