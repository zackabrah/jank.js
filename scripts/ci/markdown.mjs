/** Markdown for the CI job summaries. Pure: summary.mjs reads the reports these render. */

/** Bytes in a kilobyte, as Vite reports sizes. */
const bytesPerKb = 1000;

const msDigits = 3;

/** The most failed or retried tests listed by name. */
const listedTests = 20;

/** Playwright's final outcome for a test, after retries. */
export const outcome = {
  passed: "expected",
  flaky: "flaky",
  failed: "unexpected",
  skipped: "skipped",
};

const coverageRows = {
  lines: "Lines",
  statements: "Statements",
  functions: "Functions",
  branches: "Branches",
};

const grouped = new Intl.NumberFormat("en-US");

/** A size in kilobytes, to one decimal place. */
const kb = (bytes) => `${(bytes / bytesPerKb).toFixed(1)} kB`;

/** Milliseconds to three decimal places, or a dash when there is no reading. */
const ms = (value) => (value === null ? "–" : value.toFixed(msDigits));

/** A Markdown table: the first column left-aligned, the rest right-aligned for numbers. */
function table(header, rows) {
  const align = header.map((_, i) => (i ? "---:" : "---"));

  return [header, align, ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}

/** Unit test coverage from the `total` entry of Vitest's json-summary report. */
export function coverage(total) {
  const rows = Object.entries(coverageRows).map(([key, label]) => [
    label,
    grouped.format(total[key].covered),
    grouped.format(total[key].total),
    `${total[key].pct.toFixed(1)}%`,
  ]);

  return `### Unit test coverage\n\n${table(["", "Covered", "Total", "Coverage"], rows)}\n\nThe floors live in \`vitest.config.ts\`.\n`;
}

/** Built package files with raw and gzipped sizes, and the packed tarballs. */
export function packageFiles(files, tarballs) {
  const rows = files.map(({ name, bytes, gzipped }) => [
    `\`${name}\``,
    kb(bytes),
    kb(gzipped),
  ]);

  const packed = tarballs
    .map(({ name, bytes }) => `\`${name}\` (${kb(bytes)})`)
    .join(", ");

  return `### Package\n\n${table(["File", "Size", "Gzipped"], rows)}\n\nWhole files: an app's bundler leaves out what it doesn't import.${packed ? ` Packed: ${packed}.` : ""}\n`;
}

/** Every test in a Playwright JSON report, with its browser and where it lives. */
export function testsIn(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        browser: test.projectName,
        status: test.status,
        file: spec.file,
        title: `${spec.file} › ${spec.title}`,
      })),
    ),
    ...testsIn(suite.suites ?? []),
  ]);
}

/** Per-browser pass, retry, fail and skip counts, and the tests that failed or needed a retry. */
export function browserResults(report) {
  const tests = testsIn(report.suites ?? []);

  const browsers = [...new Set(tests.map((test) => test.browser))];

  const statuses = [
    outcome.passed,
    outcome.flaky,
    outcome.failed,
    outcome.skipped,
  ];

  const rows = browsers.map((browser) =>
    [browser].concat(
      statuses.map((status) =>
        String(
          tests.filter(
            (test) => test.browser === browser && test.status === status,
          ).length,
        ),
      ),
    ),
  );

  /** The tests with one outcome, listed under a heading, or nothing when there are none. */
  const named = (status, heading) => {
    const hits = tests.filter((test) => test.status === status);

    if (!hits.length) return "";

    const listed = hits
      .slice(0, listedTests)
      .map((test) => `- ${test.browser}: ${test.title}`);

    return `\n**${heading}**\n\n${listed.join("\n")}\n`;
  };

  return `### Browser tests\n\n${table(["Browser", "Passed", "Passed on retry", "Failed", "Skipped"], rows)}\n${named(outcome.failed, "Failed")}${named(outcome.flaky, "Passed on retry")}`;
}

/** How closely jank.js agreed with Chrome's trace, long-animation-frame timing, stats.js and stats-gl. */
export function accuracy(report) {
  /** One measured difference as median, p95 and max. */
  const spread = (label, { median, p95, max }) => [
    label,
    ms(median),
    ms(p95),
    ms(max),
  ];

  const differences = [
    spread("Frame start vs its Chrome trace callback", report.traceMatchMs),
    spread("Chrome callback time vs jank.js's cost", report.unaccountedMs),
    spread("stats.js work time vs jank.js", report.statsJsMsVsJank),
    spread("stats-gl work time vs jank.js", report.statsGlMsVsJank),
    spread("jank.js interval vs the host's rAF step", report.intervalVsHostMs),
    spread("Scope time vs the work that ran", report.scopesVsModelMs),
  ];

  const longFrames = report.longFrames.map((frame, i) => [
    `#${i + 1}`,
    ms(frame.loafMs),
    ms(frame.traceMs),
    ms(frame.jankCostMs),
  ]);

  const isolation = report.environment.isolated
    ? "cross-origin isolated"
    : "not isolated";

  return `### Accuracy against Chrome\n\n${report.frames} frames in Chromium ${report.environment.browser}, ${isolation}. Absolute differences in milliseconds; \`e2e/accuracy.spec.ts\` sets the limits.\n\n${table(["", "Median", "p95", "Max"], differences)}\n\n${table(["Long frame", "Long-animation-frame", "Chrome trace", "jank.js cost"], longFrames)}\n`;
}
