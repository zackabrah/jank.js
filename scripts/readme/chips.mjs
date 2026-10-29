/** The README's chips in junkui's theme. Pure: update.mjs reads the theme and results and writes them. */
import { outcome, testsIn } from "../ci/markdown.mjs";

// The chip box in pixels: the height the README sets, side padding and the text's baseline.
const height = 22;

const padding = 10;

const baseline = 15;

// Monospace faces advance about 0.6 em a character, so fixing the text's length lays it out the
// same in whichever face the reader's system has.
const advanceEm = 0.6;

const widthDigits = 2;

/** The browser engines the README names, by Playwright project. */
export const engines = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};

/** junkui's --jl-* tokens from its stylesheet, by name without the prefix. */
export const themeTokens = (css) =>
  Object.fromEntries(
    [...css.matchAll(/--jl-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );

/**
 * A chip's SVG drawn like a junkui control: an ink box with a control-grey hairline, a tracked
 * label in text colour and an optional value in green, set in junkui's system monospace.
 */
export function chip(theme, value, label) {
  const text = value ? `${value} ${label}` : label;

  const size = Number.parseFloat(theme["size-label"]);

  const track = Number.parseFloat(theme["track-label"]) * size;

  const step = advanceEm * size + track;

  /** One run of text at a character column, its length fixed. WebKit misplaces a fixed-length
   * text that holds a differently coloured span, so the value and label are separate. */
  const run = (words, column, fill) =>
    `<text x="${padding + column * step}" y="${baseline}" textLength="${(words.length * step - track).toFixed(widthDigits)}" lengthAdjust="spacing" fill="${fill}">${words}</text>`;

  const width = Math.round(2 * padding + text.length * step - track);

  const runs = value
    ? run(value, 0, theme.green) + run(label, value.length + 1, theme.text)
    : run(label, 0, theme.text);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${text}"><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="${theme.ink}" stroke="${theme.control}"/><g font-family="${theme.font.replaceAll('"', "'")}" font-size="${size}">${runs}</g></svg>\n`;
}

/**
 * Passing tests per engine from a Playwright JSON report. Only a clean run of every spec in
 * every engine counts: a focused run or a failure would put the wrong number in the README.
 */
export function engineCounts(report, specFiles) {
  const tests = testsIn(report.suites ?? []);

  const failed = tests.filter((test) => test.status === outcome.failed);

  if (failed.length)
    throw new Error(`${failed.length} browser tests failed in the last run`);

  return Object.fromEntries(
    Object.keys(engines).map((engine) => {
      const ran = tests.filter((test) => test.browser === engine);

      const missing = specFiles.filter(
        (file) => !ran.some((test) => test.file === file),
      );

      if (missing.length)
        throw new Error(
          `The last browser run left out ${missing.join(", ")} in ${engine}; run the full suite`,
        );

      return [
        engine,
        ran.filter(
          (test) =>
            test.status === outcome.passed || test.status === outcome.flaky,
        ).length,
      ];
    }),
  );
}

/** Passing unit tests from Vitest's JSON report, which must cover every test file and pass. */
export function unitCount(report, testFiles) {
  if (report.numFailedTests)
    throw new Error(
      `${report.numFailedTests} unit tests failed in the last run`,
    );

  const missing = testFiles.filter(
    (file) => !report.testResults.some((result) => result.name.endsWith(file)),
  );

  if (missing.length)
    throw new Error(
      `The last unit run left out ${missing.join(", ")}; run pnpm test:run`,
    );

  return report.numPassedTests;
}
