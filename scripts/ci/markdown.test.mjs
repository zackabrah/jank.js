import { test } from "node:test";

import assert from "node:assert/strict";

import {
  accuracy,
  browserResults,
  coverage,
  packageFiles,
} from "./markdown.mjs";

const measure = (covered, total, pct) => ({ covered, total, pct });

const spec = (title, tests) => ({ title, file: "panel.spec.ts", tests });

// What: coverage renders one row per measure with grouped counts and a one-decimal percentage.
// Why: the summary is read at a glance on every PR; a raw 0.6789 or 12345 is easy to misread.
await test("coverage reads as counts and percentages per measure", () => {
  const text = coverage({
    lines: measure(12_345, 18_000, 68.583),
    statements: measure(1, 2, 50),
    functions: measure(3, 4, 75),
    branches: measure(0, 0, 100),
  });

  assert.match(text, /\| Lines \| 12,345 \| 18,000 \| 68\.6% \|/);
  assert.match(text, /\| Branches \| 0 \| 0 \| 100\.0% \|/);
});

// What: browser results count each browser's outcomes from nested suites and name the tests
// that failed or only passed on retry.
// Why: a retry hides a flaky test in the pass count; naming it is how flakiness gets noticed.
await test("browser results count outcomes per browser and name failures and retries", () => {
  const text = browserResults({
    suites: [
      {
        specs: [
          spec("opens", [
            { projectName: "chromium", status: "expected" },
            { projectName: "webkit", status: "flaky" },
          ]),
        ],
        suites: [
          {
            specs: [
              spec("exports", [
                { projectName: "chromium", status: "unexpected" },
                { projectName: "webkit", status: "skipped" },
              ]),
            ],
          },
        ],
      },
    ],
  });

  assert.match(text, /\| chromium \| 1 \| 0 \| 1 \| 0 \|/);
  assert.match(text, /\| webkit \| 0 \| 1 \| 0 \| 1 \|/);
  assert.match(text, /\*\*Failed\*\*\n\n- chromium: panel\.spec\.ts › exports/);
  assert.match(
    text,
    /\*\*Passed on retry\*\*\n\n- webkit: panel\.spec\.ts › opens/,
  );
});

// What: the accuracy section shows each difference to three decimals and lists long frames,
// with a dash where Chrome's trace had no matching callback.
// Why: the differences are fractions of a millisecond; rounding them away would hide drift.
await test("accuracy shows sub-millisecond differences and each long frame", () => {
  const spread = { median: 0.0012, p95: 0.0034, max: 0.0456 };

  const text = accuracy({
    environment: { isolated: true, browser: "153.0" },
    frames: 210,
    traceMatchMs: spread,
    unaccountedMs: spread,
    statsJsMsVsJank: spread,
    statsGlMsVsJank: spread,
    intervalVsHostMs: spread,
    scopesVsModelMs: spread,
    longFrames: [{ loafMs: 131.05, traceMs: null, jankCostMs: 130.8 }],
  });

  assert.match(text, /210 frames in Chromium 153\.0, cross-origin isolated/);
  assert.match(
    text,
    /\| stats\.js work time vs jank\.js \| 0\.001 \| 0\.003 \| 0\.046 \|/,
  );
  assert.match(text, /\| #1 \| 131\.050 \| – \| 130\.800 \|/);
});

// What: package sizes read in kilobytes, with the packed tarball named after the table.
// Why: size is the tool's promise; the table is where a PR that grows it shows up.
await test("package files read as kilobytes beside the packed tarball", () => {
  const text = packageFiles(
    [{ name: "index.js", bytes: 61_234, gzipped: 20_123 }],
    [{ name: "jank.js-0.2.1.tgz", bytes: 150_000 }],
  );

  assert.match(text, /\| `index\.js` \| 61\.2 kB \| 20\.1 kB \|/);
  assert.match(text, /Packed: `jank\.js-0\.2\.1\.tgz` \(150\.0 kB\)\./);
});
