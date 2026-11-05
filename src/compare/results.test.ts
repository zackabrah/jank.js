import { describe, expect, it } from "vitest";
import { comparisonFixture } from "./fixtures.ts";
import { type ComparisonBundle, parseComparison, serializeComparison } from "./model.ts";
import { comparisonResults } from "./results.ts";

const metric = (model: ReturnType<typeof comparisonResults>, id: string) => {
  const result = model.results.find((row) => row.id === id);
  if (!result) throw new Error(`Missing ${id}`);
  return result;
};

/** The fixture's work is light for its 20 ms frames, so it reads as display-paced until this. */
function heavyGpu(bundle: ComparisonBundle) {
  for (const trial of bundle.trials)
    for (const record of trial.recording.gpuTiming?.frames ?? [])
      for (const pass of record.invocations) Object.assign(pass, { endMs: 18, milliseconds: 18 });
  return bundle;
}

describe("comparison results", () => {
  it("derives all verdicts from signed, observed paired ranges", () => {
    const mixed = comparisonResults(heavyGpu(comparisonFixture()));
    expect(metric(mixed, "CPU-median")).toMatchObject({
      a: 5,
      b: 8,
      delta: 3,
      range: [2, 4],
      verdict: "B slower",
    });
    expect(metric(mixed, "Frame-median")).toMatchObject({
      a: 20,
      b: 20,
      delta: 0,
      range: [-2, 2],
      verdict: "Inconclusive",
    });
    expect(metric(mixed, "GPU-median")).toMatchObject({
      range: [0, 0],
      verdict: "No observed difference",
    });
    expect(metric(comparisonResults(comparisonFixture("faster")), "CPU-median")).toMatchObject({
      range: [-2, -2],
      verdict: "B faster",
    });
    expect(metric(comparisonResults(comparisonFixture("gpu-gap")), "GPU-median")).toMatchObject({
      range: null,
      verdict: "Unknown",
      failure: { trial: 1 },
    });
  });
  it("weights trial summaries equally and takes within-pair deltas before aggregating", () => {
    const bundle = comparisonFixture();
    bundle.plan.pairs = 3;
    const firstA = bundle.trials[0],
      firstB = bundle.trials[1];
    if (!firstA || !firstB) throw new Error("Missing fixture pair");
    bundle.trials.push(
      { ...structuredClone(firstA), pair: 3 },
      { ...structuredClone(firstB), pair: 3 },
    );
    const costs = [1, 2, 20, 10, 100, 101];
    bundle.trials.forEach((trial, index) => {
      const cost = costs[index] ?? 0;
      trial.recording.frames.forEach((frame, i) => {
        const start = trial.measurementStartMs + i * 200;
        frame.at = start + 200;
        frame.interval = 200;
        frame.update = 0;
        frame.scopes = [{ system: "test", label: "scope", start, end: start + cost }];
      });
      trial.measurementEndMs = trial.recording.frames.at(-1)?.at ?? 0;
    });
    const result = metric(
      comparisonResults(parseComparison(serializeComparison(bundle))),
      "CPU-median",
    );
    expect(result).toMatchObject({ a: 10, b: 20, delta: 1, range: [1, 10] });
    expect(bundle.trials[1]?.recording.frames.length).not.toBe(
      bundle.trials[2]?.recording.frames.length,
    );
  });
  it("requires the plan's missing pair even when earlier pairs passed", () => {
    const model = comparisonResults(comparisonFixture("stopped"));
    for (const result of model.results)
      expect(result).toMatchObject({
        verdict: "Unknown",
        delta: null,
        range: null,
        failure: { trial: 3 },
      });
    expect(model.trials[3]?.recorded).toBe(false);
  });
  it("enforces imported thresholds, sample counts and measured window coverage", () => {
    const samples = comparisonResults(comparisonFixture("low-samples"));
    expect(metric(samples, "Frame-median").failure?.reason).toContain(
      "10 Frame samples; 20 are required",
    );
    const window = comparisonResults(comparisonFixture("low-window"));
    expect(metric(window, "CPU-median").failure?.reason).toContain("measurement window");
    const bundle = comparisonFixture("gpu-gap");
    bundle.policy.minCoverage = 0.5;
    expect(metric(comparisonResults(bundle), "GPU-median").verdict).toBe("No observed difference");
    bundle.policy.minSamples = 40;
    expect(metric(comparisonResults(bundle), "GPU-median").failure?.reason).toContain(
      "40 are required",
    );
  });
  it("reports a host without GPU timing once instead of failing every trial", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials) delete trial.recording.gpuTiming;
    const model = comparisonResults(bundle);
    expect(model.gpuRecorded).toBe(false);
    expect(metric(model, "GPU-median")).toMatchObject({
      verdict: "Unknown",
      failure: null,
      unavailable: expect.stringContaining("No GPU timing was recorded"),
    });
    for (const trial of model.trials) {
      expect(trial.metrics.GPU).toMatchObject({ recorded: false, failure: null });
      expect(trial.metrics.CPU.failure).toBeNull();
    }
    expect(metric(model, "CPU-median").verdict).toBe("No observed difference");
  });
  it("treats records with nothing timed as not recorded, unless another trial has timings", () => {
    const empty = comparisonFixture("same");
    for (const trial of empty.trials)
      if (trial.recording.gpuTiming) trial.recording.gpuTiming.frames = [];
    const none = comparisonResults(empty);
    expect(none.gpuRecorded).toBe(false);
    expect(metric(none, "GPU-median")).toMatchObject({ verdict: "Unknown", failure: null });
    // Without timer support the host still sends records, and they name the reason.
    const rejected = comparisonFixture("same");
    for (const trial of rejected.trials)
      for (const frame of trial.recording.gpuTiming?.frames ?? [])
        for (const pass of frame.invocations) {
          pass.state = "rejected";
          pass.milliseconds = pass.startMs = pass.endMs = null;
          pass.reason = "GPU timer queries unsupported";
        }
    const unsupported = comparisonResults(rejected);
    expect(unsupported.gpuRecorded).toBe(false);
    expect(metric(unsupported, "GPU-median")).toMatchObject({
      failure: null,
      unavailable: "No GPU timing was recorded: GPU timer queries unsupported.",
    });
    // A known-idle frame is a valid zero, so it counts as recorded.
    const idle = comparisonFixture("same");
    for (const trial of idle.trials)
      for (const frame of trial.recording.gpuTiming?.frames ?? []) {
        frame.inventory = "complete";
        frame.invocations = [];
      }
    expect(comparisonResults(idle).gpuRecorded).toBe(true);
    // One trial's timing went missing while others have it: that is a real coverage failure.
    const partial = comparisonFixture("same");
    const first = partial.trials[0]?.recording.gpuTiming;
    if (!first) throw new Error("Missing GPU timing");
    first.frames = [];
    const some = comparisonResults(partial);
    expect(some.gpuRecorded).toBe(true);
    expect(metric(some, "GPU-median").failure?.trial).toBe(0);
  });
  it("excludes incomplete GPU inventories and legacy evidence while preserving known idle zero", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      for (const frame of trial.recording.gpuTiming?.frames ?? []) frame.invocations = [];
    expect(metric(comparisonResults(bundle), "GPU-median")).toMatchObject({
      a: 0,
      b: 0,
      verdict: "No observed difference",
    });
    const first = bundle.trials[0];
    if (!first?.recording.gpuTiming) throw new Error("Missing fixture GPU");
    first.recording.gpuTiming.frames.forEach((frame) => {
      frame.inventory = "unknown";
    });
    expect(metric(comparisonResults(bundle), "GPU-median").verdict).toBe("Unknown");
    delete first.recording.gpuTiming;
    first.recording.gpu = {
      units: "milliseconds",
      measurement: "legacy",
      latest: null,
      samples: [],
    };
    expect(metric(comparisonResults(bundle), "GPU-median").verdict).toBe("Unknown");
  });
  it("unions overlapping CPU scopes and distinguishes scope identity from its display label", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      for (const frame of trial.recording.frames) {
        const start = frame.at - frame.interval;
        frame.scopes = [
          { system: "outer", label: "work", start, end: start + 5 },
          {
            system: "inner",
            label: "work",
            start: start + 1,
            end: start + (trial.variant === "A" ? 2 : 4),
          },
        ];
      }
    const result = comparisonResults(bundle);
    expect(metric(result, "CPU-median")).toMatchObject({ a: 5, b: 5, delta: 0 });
    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0]).toMatchObject({
      system: "inner",
      label: "work",
      a: 1,
      b: 3,
      delta: 2,
    });
  });
  it("exposes opposing scope changes hidden by totals without inventing causality", () => {
    const result = comparisonResults(comparisonFixture("scope-shifts"));
    expect(metric(result, "CPU-median")).toMatchObject({ a: 5, b: 5, range: [0, 0] });
    expect(result.opposingScopes).toBe(true);
    expect(result.scopes.map((scope) => scope.delta).sort()).toEqual([-2, 2]);
  });
  it("uses known zeros only for absent scopes in complete frames", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      if (trial.variant === "A") for (const frame of trial.recording.frames) frame.scopes = [];
    const result = comparisonResults(bundle);
    expect(result.scopes.find((scope) => scope.label === "physics")).toMatchObject({
      a: 0,
      b: 2,
      delta: 2,
    });
    for (const frame of bundle.trials[0]?.recording.frames ?? []) frame.coverage = "truncated";
    const partial = comparisonResults(bundle);
    expect(partial.scopes).toEqual([]);
    expect(partial.scopeFailure?.trial).toBe(0);
    expect(metric(partial, "CPU-median").verdict).toBe("Unknown");
  });
  it("detects overlapping frame windows rather than overstating timing coverage", () => {
    const bundle = comparisonFixture("same");
    const frame = bundle.trials[0]?.recording.frames[1];
    if (!frame) throw new Error("Missing fixture frame");
    frame.interval = 30;
    expect(metric(comparisonResults(bundle), "Frame-median").failure?.reason).toContain(
      "overlapping",
    );
  });
  // What: a problem inside one trial's recording says which trial.
  // Why: #17. A missing recording surfaced as "Cannot read properties of undefined".
  it("names the trial when its recording is missing or invalid", () => {
    const missing = JSON.parse(serializeComparison(comparisonFixture()));
    delete missing.trials[1].recording;
    expect(() => parseComparison(JSON.stringify(missing))).toThrow("Trial 1B: missing recording.");
    const invalid = JSON.parse(serializeComparison(comparisonFixture()));
    invalid.trials[0].recording.frames[0].interval = "soon";
    expect(() => parseComparison(JSON.stringify(invalid))).toThrow(/^Trial 1A: .*frame\.interval/);
  });

  // What: work the host times and reports, but doesn't scope, still counts toward CPU results.
  // Why: with the README's old setup, removing 4 ms of drawing read "No observed difference".
  it("counts update and render time that no scope covers", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      for (const frame of trial.recording.frames) {
        const start = frame.at - frame.interval;
        frame.update = 0.1;
        frame.render = trial.variant === "A" ? 4 : 0;
        frame.scopes = [{ system: "test", label: "physics", start, end: start + 0.1 }];
      }
    const result = metric(comparisonResults(bundle), "CPU-median");
    expect(result.verdict).toBe("B faster");
    expect(result.a).toBeCloseTo(4.1);
    expect(result.b).toBeCloseTo(0.1);
  });

  // What: a difference far below any browser timer reads as none.
  // Why: floating-point noise printed as +1.2e-8, and could have decided a verdict.
  it("treats floating-point noise as no difference", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      for (const frame of trial.recording.frames) {
        const start = frame.at - frame.interval;
        frame.update = 0;
        frame.scopes = [
          {
            system: "test",
            label: "work",
            start,
            end: start + 0.1 + (trial.variant === "B" ? 1e-8 : 0),
          },
        ];
      }
    expect(metric(comparisonResults(bundle), "CPU-median")).toMatchObject({
      verdict: "No observed difference",
      delta: 0,
    });
  });

  it("retains sub-millisecond differences without rounding the verdict", () => {
    const bundle = comparisonFixture("same");
    for (const trial of bundle.trials)
      for (const frame of trial.recording.frames) {
        const start = frame.at - frame.interval;
        frame.update = 0;
        frame.scopes = [
          {
            system: "test",
            label: "sub-millisecond",
            start,
            end: start + 0.01 + (trial.variant === "B" ? 0.001 : 0),
          },
        ];
      }
    const result = metric(comparisonResults(bundle), "CPU-median");
    expect(result.verdict).toBe("B slower");
    expect(result.delta).toBeCloseTo(0.001);
  });
  describe("when the display sets the pace", () => {
    const setFrames = (bundle: ComparisonBundle, trialIndex: number, intervals: number[]) => {
      const trial = bundle.trials[trialIndex];
      if (!trial) throw new Error("Missing trial");
      for (const [index, frame] of trial.recording.frames.entries()) {
        const interval = intervals[index % intervals.length] ?? 0;
        // Shorter than the fixture's slots, so frames stay ordered and inside the window.
        frame.at += interval - frame.interval;
        frame.interval = interval;
      }
    };
    const smooth = (bundle: ComparisonBundle) => {
      bundle.trials.forEach((_, index) => {
        setFrames(bundle, index, index % 2 ? [17.3, 17.9] : [17.8, 17.4]);
      });
      return bundle;
    };

    it("gives no frame verdict from jitter, and points at the display", () => {
      const model = comparisonResults(smooth(comparisonFixture("faster")));
      expect(model.displayPaced).toBe(true);
      expect(metric(model, "Frame-median").verdict).toBe("Display-paced");
      expect(metric(model, "Frame-p95").verdict).toBe("Display-paced");
      expect(metric(model, "Frame-over")).toMatchObject({ a: 0, b: 0 });
      expect(metric(model, "CPU-median").verdict).toBe("B faster");
    });

    it("keeps a p95 verdict when a build really hitches", () => {
      const bundle = smooth(comparisonFixture("same"));
      const hitching = [18, 18, 18, 18, 18, 18, 18, 18, 18, 19.9];
      setFrames(bundle, 1, hitching);
      setFrames(bundle, 2, hitching);
      const model = comparisonResults(bundle);
      expect(model.displayPaced).toBe(true);
      expect(metric(model, "Frame-p95").verdict).not.toBe("Display-paced");
      expect(metric(model, "Frame-over").b).toBeGreaterThan(0);
    });

    it("makes no claim without GPU timing, or when one build does heavy work", () => {
      const noGpu = smooth(comparisonFixture("same"));
      for (const trial of noGpu.trials) delete trial.recording.gpuTiming;
      expect(comparisonResults(noGpu).displayPaced).toBe(false);
      const heavy = smooth(comparisonFixture("same"));
      const passes = heavy.trials[1]?.recording.gpuTiming?.frames ?? [];
      for (const record of passes)
        for (const pass of record.invocations) Object.assign(pass, { endMs: 16, milliseconds: 16 });
      const model = comparisonResults(heavy);
      expect(model.displayPaced).toBe(false);
      expect(metric(model, "Frame-median").verdict).not.toBe("Display-paced");
    });
  });
  it("uses nearest-rank p95 and an explicit tolerance for frame over-budget rates", () => {
    const bundle = heavyGpu(comparisonFixture("same"));
    bundle.budgetMs = 18;
    for (const trial of bundle.trials) {
      trial.recording.budget = { targetFps: 1000 / 18, frameMs: 18 };
      for (const [index, frame] of trial.recording.frames.entries()) {
        const start = frame.at - frame.interval;
        frame.update = 0;
        frame.scopes = [
          { system: "test", label: "work", start, end: start + (index >= 47 ? 19 : 1) },
        ];
      }
    }
    const result = comparisonResults(parseComparison(serializeComparison(bundle)));
    expect(metric(result, "CPU-median").a).toBe(1);
    expect(metric(result, "CPU-p95").a).toBe(19);
    expect(metric(result, "CPU-over").a).toBe(6);
    expect(comparisonResults(bundle).frameTolerance).toBe(1);
    expect(metric(comparisonResults(bundle), "Frame-over")).toMatchObject({
      a: 100,
      b: 100,
      delta: 0,
      unit: "pts",
    });
    bundle.budgetMs = 19;
    for (const trial of bundle.trials)
      trial.recording.budget = { targetFps: 1000 / 19, frameMs: 19 };
    expect(
      metric(comparisonResults(parseComparison(serializeComparison(bundle))), "Frame-over").a,
    ).toBe(0);
  });
});
