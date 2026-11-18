import { describe, expect, test } from "vitest";
import { analyzeComparison } from "../src/agent/analyze.ts";
import { comparisonFixture } from "../src/compare/fixtures.ts";
import { experimentSummary, type TrialMeasures } from "./experiment-summary.ts";

const settings = {
  pairs: 2,
  warmupMs: 2000,
  measureMs: 10000,
  viewport: { width: 1440, height: 900 },
  browser: "headless" as const,
  scenario: undefined,
  init: [],
  replace: [],
  replaceB: [],
};

/** A-B-B-A, as jank experiment runs them, with each trial's measures as name → [start, end]. */
function trials(...measures: Record<string, [number, number][]>[]): TrialMeasures[] {
  const order = [
    { pair: 1, variant: "A" },
    { pair: 1, variant: "B" },
    { pair: 2, variant: "B" },
    { pair: 2, variant: "A" },
  ] as const;
  return order.map((slot, index) => ({
    ...slot,
    measures: Object.entries(measures[index] ?? {}).flatMap(([name, spans]) =>
      spans.map(([start, end]) => ({ name, start, end })),
    ),
  }));
}

const analysis = analyzeComparison(comparisonFixture());
const coldRow = (summary: ReturnType<typeof experimentSummary>) => {
  const row = summary.rows[0];
  if (row?.phase !== "cold load") throw new Error("Expected the cold-load row first.");
  return row;
};

describe("cold load", () => {
  // The row exists to answer "did B load faster?", so it has to compare builds the way the
  // frame results do (paired differences, a verdict only when every pair agrees) and carry the
  // same noise guard, or an agent would trust one row more than the other for no reason.
  test("compares each measure across pairs like the frame results", () => {
    const summary = experimentSummary(
      settings,
      trials({ load: [[0, 100]] }, { load: [[0, 60]] }, { load: [[0, 70]] }, { load: [[0, 110]] }),
      analysis,
    );
    expect(coldRow(summary).measures).toEqual({
      load: {
        unit: "ms",
        a: 105,
        b: 65,
        runs: { A: 2, B: 2 },
        delta: -40,
        range: [-40, -40],
        verdict: "B faster",
        noise: 10,
        withinNoise: false,
      },
    });
  });

  // Hosts often measure one phase per material or file, and those entries overlap. Adding them
  // would report more time than the phase took, so overlapping entries of one name count once.
  test("counts overlapping entries of one name once", () => {
    const overlapping: Record<string, [number, number][]> = {
      compile: [
        [0, 30],
        [20, 50],
        [80, 90],
      ],
    };
    const summary = experimentSummary(
      settings,
      trials(overlapping, overlapping, overlapping, overlapping),
      analysis,
    );
    const { compile } = coldRow(summary).measures ?? {};
    expect(compile).toMatchObject({
      a: 60,
      b: 60,
      delta: 0,
      verdict: "No observed difference",
    });
  });

  // Missing is not zero: a phase only one build measures, or one a trial skipped, must not read
  // as free, and a verdict needs every pair.
  test("leaves a measure a build or trial didn't report unknown, not zero", () => {
    const summary = experimentSummary(
      settings,
      trials(
        { load: [[0, 100]] },
        { load: [[0, 60]], decode: [[0, 5]] },
        { load: [[0, 70]], decode: [[0, 7]] },
        {},
      ),
      analysis,
    );
    const { decode, load } = coldRow(summary).measures ?? {};
    expect(decode).toMatchObject({
      a: null,
      b: 6,
      runs: { A: 0, B: 2 },
      delta: null,
      range: null,
      verdict: "Unknown",
      withinNoise: false,
    });
    expect(load).toMatchObject({
      a: 100,
      runs: { A: 1, B: 2 },
      delta: -40,
      range: null,
      verdict: "Unknown",
    });
  });

  // An empty row of zeros would look like an instant load. Say there's no evidence instead.
  test("says so when the host measured nothing", () => {
    const row = coldRow(experimentSummary(settings, trials(), analysis));
    expect(row.measures).toBeNull();
    expect("note" in row && row.note).toContain("no performance.measure entries");
  });
});

describe("steady play", () => {
  // The second row is the comparison itself, keyed for lookup, so the two rows can't disagree.
  test("carries the comparison results, keyed by id", () => {
    const row = experimentSummary(settings, trials(), analysis).rows[1];
    const frame = analysis.results.find((result) => result.id === "Frame-median");
    expect(row).toMatchObject({
      phase: "steady play",
      measureMs: analysis.plan.measureMs,
      displayLimited: analysis.displayLimited,
    });
    expect(row && "results" in row && row.results["Frame-median"]).toEqual({
      ...frame,
      id: undefined,
    });
  });

  // A comparison too large to import still leaves a summary with the load row and settings.
  test("reports a comparison that couldn't be analyzed", () => {
    const row = experimentSummary(settings, trials(), { error: "too large" }).rows[1];
    expect(row).toEqual({ phase: "steady play", source: "comparison", error: "too large" });
  });
});

describe("settings", () => {
  // Two result folders are only comparable if they ran the same scenario. A file name can stay
  // the same while its contents change, so the summary records a hash of what actually ran.
  test("fingerprints scripts by content and records rules as typed", () => {
    const run = (scenario: string) =>
      experimentSummary(
        {
          ...settings,
          scenario: { file: "orbit.js", text: scenario },
          init: [{ file: "seed.js", text: "Math.random = () => 0.5;" }],
          replace: [{ glob: "**/*.wgsl", find: "SEED", to: "{nonce}" }],
        },
        trials(),
        analysis,
      ).settings;
    const first = run("camera.orbit(1);");
    expect(first).toMatchObject({
      viewport: "1440x900",
      scenario: { file: "orbit.js" },
      init: [{ file: "seed.js" }],
      replace: ["**/*.wgsl::SEED::{nonce}"],
      coldCompile: { A: true, B: true },
    });
    expect(first.scenario?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run("camera.orbit(1);").scenario?.sha256).toBe(first.scenario?.sha256);
    expect(run("camera.orbit(2);").scenario?.sha256).not.toBe(first.scenario?.sha256);
  });

  // A {nonce} only in --replace-b makes B pay for shader compiles that A may skip, which would
  // show up as B loading slower. That's a confound, so the notes name it.
  test("warns when only B forces a cold compile", () => {
    const summary = experimentSummary(
      { ...settings, replaceB: [{ glob: "**/*.wgsl", find: "SEED", to: "{nonce}" }] },
      trials(),
      analysis,
    );
    expect(summary.settings.coldCompile).toEqual({ A: false, B: true });
    expect(summary.notes.join(" ")).toContain("Only B forces a cold shader compile");
  });

  // Fresh contexts empty the HTTP cache but not compiled shaders, so without a nonce the notes
  // say later trials may be warmer than the first.
  test("notes that shaders may be cached when no rule forces a compile", () => {
    const { notes } = experimentSummary(settings, trials(), analysis);
    expect(notes.join(" ")).toContain("may skip compiles");
  });
});
