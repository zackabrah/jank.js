import { expect, it } from "vitest";
import { comparisonReportFixture } from "../../../../tests/fixtures/comparison-report.ts";
import { parseComparison } from "./codec.ts";

it("recalculates imported timing and coverage rather than trusting stored summaries", () => {
  const original = comparisonReportFixture();
  const json = JSON.stringify({
    ...original,
    summary: { cpu: "forged" },
    trials: original.trials.map((trial) => ({ ...trial, cpu: { medianMs: 999 }, gpuCoverage: 1 })),
  });
  const result = parseComparison(json);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.problem.message);
  }
  expect(result.comparison.summary.cpu?.p95.pairedRange).toEqual([-2, 2]);
  expect(result.comparison.summary.gpu).toBeNull();
  expect(result.comparison.trials[1]?.gpuCoverage).toBe(0.6);
});
it("rejects malformed nested recordings, incomplete complete reports and mismatched budgets", () => {
  const original = comparisonReportFixture();
  const first = original.trials[0];
  if (!first) {
    throw new Error("Missing trial");
  }
  for (const invalid of [
    { ...original, trials: original.trials.slice(0, 3) },
    { ...original, trials: [first, first, ...original.trials.slice(2)] },
    { ...original, targetFps: 120 },
    {
      ...original,
      trials: [
        { ...first, recording: { ...first.recording, frames: [{ id: 1 }] } },
        ...original.trials.slice(1),
      ],
    },
  ]) {
    expect(parseComparison(JSON.stringify(invalid)).ok).toBe(false);
  }
});

it("retains cancelled evidence without presenting aggregate conclusions", () => {
  const report = comparisonReportFixture();
  const parsed = parseComparison(
    JSON.stringify({ ...report, status: "cancelled", trials: report.trials.slice(0, 1) }),
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.problem.message);
  }
  expect(parsed.comparison.summary).toEqual({ cpu: null, gpu: null, frame: null });
  expect(parsed.comparison.trials).toHaveLength(1);
});
it("returns precise nested errors and bounded format/context/window validation", () => {
  const report = comparisonReportFixture();
  const first = report.trials[0];
  if (!first) {
    throw new Error("Missing trial");
  }
  const invalidTrial = {
    ...first,
    recording: { ...first.recording, frames: [{ ...first.recording.frames[0], endedAtMs: -1 }] },
  };
  const parsed = parseComparison(
    JSON.stringify({ ...report, trials: [invalidTrial, ...report.trials.slice(1)] }),
  );
  expect(parsed.ok).toBe(false);
  if (parsed.ok) {
    throw new Error("Accepted invalid frame");
  }
  expect(parsed.problem.path).toBe("$.trials[0].recording.frames[0].endedAtMs");
  for (const invalid of [
    { ...report, version: 2 },
    { ...report, status: "idle" },
    { ...report, options: { ...report.options, pairs: 1 } },
    { ...report, targetFps: Number.MIN_VALUE },
    {
      ...report,
      trials: report.trials.map((trial) => ({
        ...trial,
        context: { ...trial.context, resolution: { widthPx: 0, heightPx: 1 } },
      })),
    },
    {
      ...report,
      trials: report.trials.map((trial) => ({
        ...trial,
        context: { ...trial.context, label: "x".repeat(257) },
      })),
    },
    {
      ...report,
      trials: report.trials.map((trial) => ({
        ...trial,
        recording: {
          ...trial.recording,
          frames: trial.recording.frames.map((frame) => ({
            ...frame,
            startedAtMs: frame.startedAtMs * 2,
            endedAtMs: frame.endedAtMs * 2,
            scopes: [],
          })),
        },
      })),
    },
  ]) {
    expect(parseComparison(JSON.stringify(invalid)).ok).toBe(false);
  }
  expect(parseComparison("{")).toMatchObject({ ok: false, problem: { code: "invalid-json" } });
  expect(parseComparison(" ".repeat(32 * 1024 * 1024 + 1))).toMatchObject({
    ok: false,
    problem: { code: "too-large" },
  });
});
it("accepts empty cancelled bundles and signed, boolean, string and duplicate-labelled settings", () => {
  const report = comparisonReportFixture();
  const empty = parseComparison(JSON.stringify({ ...report, status: "cancelled", trials: [] }));
  expect(empty.ok).toBe(true);
  const parsed = parseComparison(
    JSON.stringify({
      ...report,
      trials: report.trials.map((trial) => ({
        ...trial,
        context: {
          ...trial.context,
          resolution: null,
          settings: [
            { label: "Value", value: -1 },
            { label: "Value", value: true },
            { label: "Value", value: "<script>label</script>" },
          ],
        },
      })),
    }),
  );
  expect(parsed.ok).toBe(true);
});
