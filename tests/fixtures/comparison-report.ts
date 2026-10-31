import {
  summarizeComparison,
  summarizeComparisonTrial,
} from "../../packages/jank/src/analysis/comparison.ts";
import type {
  ComparisonReport,
  ComparisonTrial,
} from "../../packages/jank/src/comparison/comparison.ts";
import { gpuIntervalFixture } from "./gpu-sample.ts";
import { recordingFixture } from "./recording.ts";

export function comparisonReportFixture(): ComparisonReport {
  const trials: ComparisonTrial[] = ["A", "B", "B", "A"].map((name, index) => {
    const variant = name === "A" ? "A" : "B";
    const pair = Math.floor(index / 2) + 1;
    const cpuMs = [2, 4, 4, 6][index] ?? 2;
    const recording = {
      ...recordingFixture(),
      frames: Array.from({ length: 50 }, (_, frame) => ({
        id: frame + 1,
        startedAtMs: frame * 20,
        endedAtMs: (frame + 1) * 20,
        cpu: { updateMs: cpuMs, renderMs: 1 },
        scopes: [{ channelId: "physics", startedAtMs: frame * 20, endedAtMs: frame * 20 + cpuMs }],
        coverage: { status: "complete" as const },
        overhead: { collectionMs: 0.01, refreshMs: 0 },
      })),
      gpu: Array.from({ length: index === 1 ? 30 : 50 }, (_, frame) => ({
        ...gpuIntervalFixture(),
        frameId: frame + 1,
        sequence: frame + 1,
      })),
    };
    return {
      pair,
      variant,
      recording,
      context: {
        label: `Scene ${variant}`,
        settings: [
          { label: "Objects", value: variant === "A" ? 64 : 128 },
          { label: "Shadows", value: true },
        ],
        resolution: { widthPx: variant === "A" ? 800 : 400, heightPx: 600 },
        animation: variant === "A" ? "Animated" : "Frozen",
      },
      finalization: "settled",
      ...summarizeComparisonTrial(recording, 1000),
    };
  });
  return {
    format: "jank.js-comparison",
    version: 1,
    status: "complete",
    stage: "ready",
    pair: 2,
    variant: "A",
    reason: "Comparison complete",
    options: { pairs: 2, warmupMs: 500, measureMs: 1000 },
    targetFps: 60,
    trials,
    summary: summarizeComparison(trials, 2, true),
  };
}
