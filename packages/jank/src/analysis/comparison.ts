import type {
  ComparisonDifference,
  ComparisonMetric,
  ComparisonTiming,
  ComparisonTrial,
} from "../comparison/comparison.ts";
import type { Recording } from "../recordings/recording.ts";
import { summarizeGpuCoverage } from "./gpu-coverage.ts";

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return (
    ((sorted[Math.floor(sorted.length / 2)] ?? 0) +
      (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0)) /
    2
  );
}
function timing(values: number[], budgetMs: number, eligible: boolean): ComparisonTiming | null {
  if (!eligible || values.length < 20) {
    return null;
  }
  values.sort((a, b) => a - b);
  return {
    samples: values.length,
    medianMs: median(values),
    p95Ms: values[Math.floor((values.length - 1) * 0.95)] ?? 0,
    overBudgetPercent: (values.filter((value) => value > budgetMs).length / values.length) * 100,
  };
}
function gpuValues(recording: Recording) {
  const ids = new Set(recording.frames.map((frame) => frame.id));
  const byFrame = new Map<
    number,
    { value: number; measurement: "busy" | "pass-sum" | "elapsed-span" }
  >();
  const ambiguous = new Set<number>();
  for (const sample of recording.gpu) {
    if (sample.frameId === null || !ids.has(sample.frameId)) {
      continue;
    }
    const value = sample.measurement === "intervals" ? sample.metrics?.busyMs : sample.durationMs;
    if (value == null) {
      continue;
    }
    if (byFrame.has(sample.frameId)) {
      ambiguous.add(sample.frameId);
    }
    byFrame.set(sample.frameId, {
      value,
      measurement: sample.measurement === "intervals" ? "busy" : sample.measurement,
    });
  }
  for (const id of ambiguous) {
    byFrame.delete(id);
  }
  const measurements = new Set([...byFrame.values()].map((sample) => sample.measurement));
  return {
    values: [...byFrame.values()].map((sample) => sample.value),
    measurement: measurements.size > 1 ? null : (measurements.values().next().value ?? null),
  };
}
/** Unknown CPU totals and incomplete/ambiguous GPU measurements never become zero. */
export function summarizeComparisonTrial(recording: Recording, measureMs: number) {
  const frame = recording.frames.map((sample) => sample.endedAtMs - sample.startedAtMs);
  const cpu = recording.frames.flatMap((sample) =>
    sample.cpu.updateMs === null || sample.cpu.renderMs === null
      ? []
      : [sample.cpu.updateMs + sample.cpu.renderMs],
  );
  const gpu = gpuValues(recording);
  const frames = frame.length;
  const windowCoverage = frame.reduce((sum, duration) => sum + duration, 0) / measureMs;
  const cpuCoverage = frames ? cpu.length / frames : 0;
  const gpuCoverage = frames ? gpu.values.length / frames : 0;
  const enough = windowCoverage >= 0.8;
  const budgetMs = 1000 / recording.targetFps;
  return {
    frames,
    truncated: recording.truncated,
    windowCoverage,
    cpuCoverage,
    gpuCoverage,
    intervalCoverage: summarizeGpuCoverage(recording),
    gpuMeasurement: gpu.measurement,
    cpu: timing(cpu, budgetMs, enough && cpuCoverage >= 0.8),
    gpu: timing(gpu.values, budgetMs, enough && gpuCoverage >= 0.8 && gpu.measurement !== null),
    frame: timing(frame, budgetMs + Math.max(1, budgetMs * 0.05), enough),
  };
}
function difference(a: readonly number[], b: readonly number[]): ComparisonDifference {
  const deltas = b.map((value, index) => value - (a[index] ?? 0));
  const aMedian = median(a);
  const deltaMs = median(deltas);
  return {
    a: aMedian,
    b: median(b),
    deltaMs,
    deltaPercent: aMedian === 0 ? null : (deltaMs / aMedian) * 100,
    pairedRange: [Math.min(...deltas), Math.max(...deltas)],
  };
}
function compare(
  trials: readonly Omit<ComparisonTrial, "recording">[],
  key: "cpu" | "gpu" | "frame",
): ComparisonMetric | null {
  if (key === "gpu" && new Set(trials.map((trial) => trial.gpuMeasurement)).size !== 1) {
    return null;
  }
  const a = trials
    .filter((trial) => trial.variant === "A")
    .toSorted((x, y) => x.pair - y.pair)
    .flatMap((trial) => trial[key] ?? []);
  const b = trials
    .filter((trial) => trial.variant === "B")
    .toSorted((x, y) => x.pair - y.pair)
    .flatMap((trial) => trial[key] ?? []);
  if (a.length !== trials.length / 2 || b.length !== a.length) {
    return null;
  }
  const aOver = median(a.map((value) => value.overBudgetPercent));
  const bOver = median(b.map((value) => value.overBudgetPercent));
  return {
    median: difference(
      a.map((value) => value.medianMs),
      b.map((value) => value.medianMs),
    ),
    p95: difference(
      a.map((value) => value.p95Ms),
      b.map((value) => value.p95Ms),
    ),
    overBudget: { a: aOver, b: bOver, deltaPoints: bOver - aOver },
  };
}
/** Equal trial weight and within-pair differences; no significance or winner claim. */
export function summarizeComparison(
  trials: readonly Omit<ComparisonTrial, "recording">[],
  pairs: number,
  complete: boolean,
) {
  if (!complete || trials.length !== pairs * 2) {
    return { cpu: null, gpu: null, frame: null };
  }
  return {
    cpu: compare(trials, "cpu"),
    gpu: compare(trials, "gpu"),
    frame: compare(trials, "frame"),
  };
}
