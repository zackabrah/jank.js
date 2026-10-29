import { test } from "node:test";

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { chip, engineCounts, themeTokens, unitCount } from "./chips.mjs";

const theme = themeTokens(readFileSync("src/ui/junkui.css", "utf8"));

/** A Playwright JSON report with one test per browser and spec file, all with one status. */
const report = (
  files,
  status,
  browsers = ["chromium", "firefox", "webkit"],
) => ({
  suites: files.map((file) => ({
    specs: [
      {
        file,
        title: "a test",
        tests: browsers.map((projectName) => ({ projectName, status })),
      },
    ],
  })),
});

// What: a chip takes junkui's colours, label size, tracking and font from its stylesheet, puts
// the value in green before the label, and fixes the text's length to its tracked monospace width.
// Why: the README's chips should look like the panel, and the reader's system picks the face, so
// the length must not depend on it.
await test("a chip is drawn from junkui's tokens", () => {
  const svg = chip(theme, "93", "UNIT TESTS");

  // Characters of 0.6 em at 11 px, tracked 0.12 em between them; 10 px of padding a side.
  const step = 6.6 + 1.32;

  /** A run's fixed length: its characters, less the tracking after the last. */
  const length = (characters) => (characters * step - 1.32).toFixed(2);

  assert.match(svg, /aria-label="93 UNIT TESTS"/);
  assert.match(
    svg,
    new RegExp(`width="${Math.round(20 + 13 * step - 1.32)}" height="22"`),
  );
  assert.match(
    svg,
    new RegExp(`fill="${theme.ink}" stroke="${theme.control}"`),
  );
  assert.match(svg, new RegExp(`font-family="${theme.font}" font-size="11"`));
  assert.match(
    svg,
    new RegExp(
      `<text x="10" [^>]*textLength="${length(2)}"[^>]*fill="${theme.green}">93</text>`,
    ),
  );
  assert.match(
    svg,
    new RegExp(
      `<text x="${10 + 3 * step}" [^>]*textLength="${length(10)}"[^>]*fill="${theme.text}">UNIT TESTS</text>`,
    ),
  );
});

// What: browser counts take tests that passed, including on a retry, per engine.
// Why: a flaky pass is still a pass for the commit the hook allowed.
await test("each engine counts its passing tests", () => {
  const counts = engineCounts(
    {
      suites: [
        ...report(["a.spec.ts"], "expected").suites,
        ...report(["b.spec.ts"], "flaky", ["chromium"]).suites,
        ...report(["b.spec.ts"], "skipped", ["firefox", "webkit"]).suites,
      ],
    },
    ["a.spec.ts", "b.spec.ts"],
  );

  assert.deepEqual(counts, { chromium: 2, firefox: 1, webkit: 1 });
});

// What: a focused run, a missing engine or any failure is refused instead of counted.
// Why: the last run is often one spec in one browser; its count must never reach the README.
await test("only a clean run of every spec in every engine counts", () => {
  const unit = {
    numFailedTests: 0,
    numPassedTests: 4,
    testResults: [{ name: "/x/src/a.test.ts" }],
  };

  assert.throws(
    () =>
      engineCounts(report(["a.spec.ts"], "expected"), [
        "a.spec.ts",
        "b.spec.ts",
      ]),
    /left out b\.spec\.ts in chromium/,
  );
  assert.throws(
    () =>
      engineCounts(report(["a.spec.ts"], "expected", ["chromium"]), [
        "a.spec.ts",
      ]),
    /in firefox/,
  );
  assert.throws(
    () => engineCounts(report(["a.spec.ts"], "unexpected"), ["a.spec.ts"]),
    /3 browser tests failed/,
  );
  assert.throws(
    () => unitCount(unit, ["a.test.ts", "b.test.ts"]),
    /left out b\.test\.ts/,
  );
  assert.equal(unitCount(unit, ["a.test.ts"]), 4);
});
