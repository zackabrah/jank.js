import { createHash } from "node:crypto";
import { type analyzeComparison, spreadWithinVariants } from "../src/agent/analyze.ts";
import type { VariantKey } from "../src/compare/model.ts";
import { median, verdict } from "../src/compare/results.ts";
import { unionDuration } from "../src/recording/timing.ts";

const NONCE = "{nonce}";

/** A script as it was read once for the whole run, so every trial ran the same text. */
export interface Script {
  file: string;
  text: string;
}

interface Rule {
  glob: string;
  find: string;
  to: string;
}

/** The host's `performance.measure` entries in one trial, as they stood when recording began. */
export interface TrialMeasures {
  pair: number;
  variant: VariantKey;
  measures: { name: string; start: number; end: number }[];
}

interface Settings {
  pairs: number;
  warmupMs: number;
  measureMs: number;
  viewport: { width: number; height: number };
  browser: "chrome" | "headless" | "cdp";
  scenario: Script | undefined;
  init: Script[];
  replace: Rule[];
  replaceB: Rule[];
}

type ComparisonAnalysis = ReturnType<typeof analyzeComparison>;

const rounded = (value: number) => Number(value.toFixed(2));
const roundedOrNull = (value: number | null) => (value === null ? null : rounded(value));
/**
 * Far below any timer's resolution, as comparisonResults rounds its paired differences: equal
 * durations rebuilt from different start times (end - start) must compare as equal.
 */
const normalized = (value: number) => Math.round(value * 1e6) / 1e6;

/** By content, not only by name: an edited scenario is a different run. */
const fingerprint = ({ file, text }: Script) => ({
  file,
  sha256: createHash("sha256").update(text).digest("hex"),
});

const ruleText = ({ glob, find, to }: Rule) => `${glob}::${find}::${to}`;
const usesNonce = (rules: readonly Rule[]) => rules.some((rule) => rule.to.includes(NONCE));

/**
 * One value per trial, compared as the comparison results are: the median for each build, the
 * median of the B - A differences within pairs, and their range across pairs for the verdict.
 * A trial without a value stays out of the medians and leaves the range unknown, never zero.
 */
function paired(
  values: readonly { pair: number; variant: VariantKey; value: number | null }[],
  pairs: number,
) {
  const of = (variant: VariantKey) =>
    values.flatMap((entry) =>
      entry.variant === variant && entry.value !== null ? [entry.value] : [],
    );
  const valueAt = (pair: number, variant: VariantKey) =>
    values.find((entry) => entry.pair === pair && entry.variant === variant)?.value ?? null;
  const differences: number[] = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const a = valueAt(pair, "A");
    const b = valueAt(pair, "B");
    if (a !== null && b !== null) differences.push(normalized(b - a));
  }
  const range: [number, number] | null =
    differences.length === pairs && pairs > 0
      ? [Math.min(...differences), Math.max(...differences)]
      : null;
  const delta = median(differences);
  const noise = spreadWithinVariants(values);
  return {
    unit: "ms" as const,
    a: roundedOrNull(median(of("A"))),
    b: roundedOrNull(median(of("B"))),
    runs: { A: of("A").length, B: of("B").length },
    delta: roundedOrNull(delta),
    range: range ? range.map(rounded) : null,
    verdict: verdict(range),
    noise,
    withinNoise: noise !== null && delta !== null && Math.abs(delta) <= noise,
  };
}

/** Each measure name's time, merged where its entries overlap, so repeats aren't counted twice. */
function coldLoad(trials: readonly TrialMeasures[], pairs: number) {
  const names = [...new Set(trials.flatMap((trial) => trial.measures.map(({ name }) => name)))];
  const row = { phase: "cold load" as const, source: "performance.measure" as const };
  if (!names.length)
    return {
      ...row,
      measures: null,
      note: "The host recorded no performance.measure entries before recording began, so cold-load cost is unknown. Wrap startup phases in performance.measure to fill this row.",
    };
  return {
    ...row,
    measures: Object.fromEntries(
      names.toSorted().map((name) => [
        name,
        paired(
          trials.map(({ pair, variant, measures }) => {
            const spans = measures.filter((measure) => measure.name === name);
            return { pair, variant, value: spans.length ? normalized(unionDuration(spans)) : null };
          }),
          pairs,
        ),
      ]),
    ),
  };
}

function steadyPlay(comparison: ComparisonAnalysis | { error: string }) {
  const row = { phase: "steady play" as const, source: "comparison" as const };
  if ("error" in comparison) return { ...row, error: comparison.error };
  return {
    ...row,
    measureMs: comparison.plan.measureMs,
    displayLimited: comparison.displayLimited,
    machineBusy: comparison.machineBusy,
    results: Object.fromEntries(comparison.results.map(({ id, ...result }) => [id, result])),
  };
}

/**
 * Cold-load cost and steady-play frame time side by side, with the settings that produced them,
 * so runs can be compared without lining up `loads` and `comparison` by hand.
 */
export function experimentSummary(
  settings: Settings,
  trials: readonly TrialMeasures[],
  comparison: ComparisonAnalysis | { error: string },
) {
  // That a rule put {nonce} into a build's responses, not that it reached a shader: only the
  // rule's target decides whether it forces a compile, and the summary can't see that.
  const nonce = {
    A: usesNonce(settings.replace),
    B: usesNonce([...settings.replace, ...settings.replaceB]),
  };
  const notes = [
    "cold load is each host performance.measure name's time, from page load until recording began (after the scenario and warmup). Overlapping entries with one name count once. It covers only what the host measures: frames before recording are not kept.",
    "steady play is comparison.results: the frames recorded for measureMs after the scenario and warmup.",
    "Both rows compare builds the same way: a and b are medians, delta is the median B - A difference within pairs, and a verdict needs the range across pairs to exclude zero. Treat a withinNoise result as no evidence either way.",
    "Every trial starts with an empty HTTP cache, but compiled shaders can outlive a browser context, so trials after the first may skip compiles the first one paid for. A {nonce} rule forces a compile only if it changes shader source: settings.nonce records that a rule used {nonce}, not what it changed.",
  ];
  if (nonce.A !== nonce.B)
    notes.push(
      "Only B has a {nonce} rule (--replace-b). If it changes shader source, B's load times include compiles that A may have cached. Use --replace to apply it to both builds.",
    );
  return {
    settings: {
      pairs: settings.pairs,
      warmupMs: settings.warmupMs,
      measureMs: settings.measureMs,
      viewport: `${settings.viewport.width}x${settings.viewport.height}`,
      browser: settings.browser,
      scenario: settings.scenario ? fingerprint(settings.scenario) : null,
      init: settings.init.map(fingerprint),
      replace: settings.replace.map(ruleText),
      replaceB: settings.replaceB.map(ruleText),
      nonce,
    },
    rows: [coldLoad(trials, settings.pairs), steadyPlay(comparison)],
    notes,
  };
}
