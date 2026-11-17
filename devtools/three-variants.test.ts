import { expect, test } from "vitest";
import { settingDifferences } from "../src/compare/model.ts";
import { type comparisonCandidates, comparisonVariants } from "./three-variants.ts";

test("a one-setting preset has no confounds and a broader one reports them", () => {
  const confounds = (candidate: (typeof comparisonCandidates)[number]) => {
    const { variants, change } = comparisonVariants(candidate, "webgl2");
    return { change, others: settingDifferences(variants, change) };
  };
  expect(confounds("CPU stress")).toEqual({ change: "cpuMs", others: [] });
  expect(confounds("GPU stress")).toEqual({
    change: "instances",
    others: ["passes", "resolution"],
  });
  expect(confounds("Mixed")).toEqual({
    change: "cpuMs",
    others: ["instances", "passes", "resolution"],
  });
});

test("each variant reports the workload and backend the host runs", () => {
  const { variants } = comparisonVariants("CPU stress", "webgpu");
  expect(variants.A).toEqual({
    label: "Baseline",
    settings: { backend: "webgpu", cpuMs: 0, instances: 144, passes: 1, resolution: 1 },
  });
  expect(variants.B.settings.cpuMs).toBe(14);
});
