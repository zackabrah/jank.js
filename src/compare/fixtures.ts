import { recordingFixture } from "../recording/fixtures.ts";
import { type ComparisonBundle, comparisonSchedule, parseComparison } from "./model.ts";

export type ComparisonScenario =
  | "mixed"
  | "faster"
  | "same"
  | "inconclusive"
  | "gpu-gap"
  | "scope-shifts"
  | "stopped"
  | "low-samples"
  | "low-window";
/** Explicitly simulated review data; never production measurements. */
export function comparisonFixture(scenario: ComparisonScenario = "mixed"): ComparisonBundle {
  const bundle: ComparisonBundle = {
    format: "jank.js-comparison",
    version: 1,
    status: scenario === "stopped" ? "stopped" : "complete",
    reason: scenario === "stopped" ? "Stopped by reference host." : "",
    plan: { warmupMs: 500, measureMs: 1000, pairs: 2 },
    budgetMs: 1000 / 60,
    policy: { minSamples: 20, minCoverage: 0.8 },
    change: "workload",
    variants: {
      A: { label: "SIMULATED baseline", settings: { workload: "A", objects: 64 } },
      B: { label: "SIMULATED candidate", settings: { workload: "B", objects: 128 } },
    },
    trials: [],
  };
  bundle.trials = comparisonSchedule(2).map((planned, index) => {
    const b = planned.variant === "B";
    const same = scenario === "same" || scenario === "scope-shifts";
    const shift = !b || same ? 0 : scenario === "faster" ? -2 : planned.pair === 1 ? 2 : -2;
    const interval = scenario === "low-samples" ? 100 : 20 + shift;
    const count = Math.ceil(1000 / interval);
    const recording = recordingFixture(count);
    const measurementStartMs = index * 2000 + 500;
    const physics =
      !b || scenario === "same"
        ? 2
        : scenario === "faster"
          ? 1
          : scenario === "inconclusive"
            ? 2 + shift / 2
            : 4;
    const scene =
      !b || scenario === "same"
        ? 3
        : scenario === "scope-shifts"
          ? 1
          : scenario === "faster"
            ? 2
            : scenario === "inconclusive"
              ? 3 + shift / 2
              : planned.pair === 1
                ? 3
                : 5;
    recording.frames = recording.frames.map((frame, i) => {
      const start = measurementStartMs + i * interval;
      return {
        ...frame,
        at: start + interval,
        interval,
        update: physics + scene,
        render: 0,
        scopes: [
          { system: "simulation", label: "physics", start, end: start + physics },
          {
            system: "simulation",
            label: "scene update",
            start: start + physics,
            end: start + physics + scene,
          },
        ],
      };
    });
    if (scenario === "low-window")
      recording.frames = recording.frames.filter((_, i) => i % 2 === 0 || i === count - 1);
    const gpu = scenario === "faster" && b ? 2 : 4;
    recording.gpuTiming = {
      version: 1,
      frames: recording.frames
        .filter(
          (_, i) =>
            scenario !== "gpu-gap" || index !== 1 || i < Math.ceil(recording.frames.length * 0.6),
        )
        .map((frame) => ({
          frameId: frame.id,
          source: "host",
          clock: "gpu",
          epoch: 1,
          resolutionMs: 0.01,
          inventory: "complete",
          omitted: 0,
          invocations: [
            {
              id: `render-${frame.id}`,
              label: "SIMULATED render",
              kind: "render",
              state: "timed",
              milliseconds: gpu,
              startMs: 0,
              endMs: gpu,
              reason: null,
            },
          ],
        })),
    };
    return {
      ...planned,
      recording,
      measurementStartMs,
      measurementEndMs: measurementStartMs + count * interval,
    };
  });
  if (scenario === "stopped") bundle.trials.pop();
  return parseComparison(JSON.stringify(bundle));
}
