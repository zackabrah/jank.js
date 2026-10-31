import type { GpuCoverage } from "../analysis/gpu-coverage.ts";
import type { Recording } from "../recordings/recording.ts";

export interface ComparisonOptions {
  readonly pairs: number;
  readonly warmupMs: number;
  readonly measureMs: number;
}
export interface ComparisonContext {
  readonly label: string;
  readonly settings: readonly {
    readonly label: string;
    readonly value: string | number | boolean;
  }[];
  readonly resolution: { readonly widthPx: number; readonly heightPx: number } | null;
  readonly animation: string;
}
/** begin snapshots configuration; apply runs at a host boundary; restore releases only host-owned state. */
export interface ComparisonHost {
  begin(): {
    apply(variant: "A" | "B"): ComparisonContext;
    check?(): string | null;
    restore(): void;
  };
}
export interface ComparisonTiming {
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly overBudgetPercent: number;
}
export interface ComparisonTrial {
  readonly pair: number;
  readonly variant: "A" | "B";
  readonly context: ComparisonContext;
  readonly recording: Recording;
  readonly finalization: string;
  readonly frames: number;
  readonly truncated: boolean;
  readonly windowCoverage: number;
  readonly cpuCoverage: number;
  readonly gpuCoverage: number;
  readonly intervalCoverage: GpuCoverage;
  readonly gpuMeasurement: "busy" | "pass-sum" | "elapsed-span" | null;
  readonly cpu: ComparisonTiming | null;
  readonly gpu: ComparisonTiming | null;
  readonly frame: ComparisonTiming | null;
}
export interface ComparisonDifference {
  readonly a: number;
  readonly b: number;
  readonly deltaMs: number;
  readonly deltaPercent: number | null;
  readonly pairedRange: readonly [number, number];
}
export interface ComparisonMetric {
  readonly median: ComparisonDifference;
  readonly p95: ComparisonDifference;
  readonly overBudget: { readonly a: number; readonly b: number; readonly deltaPoints: number };
}
export interface ComparisonSummary {
  readonly cpu: ComparisonMetric | null;
  readonly gpu: ComparisonMetric | null;
  readonly frame: ComparisonMetric | null;
}
export interface ComparisonSnapshot {
  readonly status: "idle" | "running" | "complete" | "cancelled";
  readonly stage: "ready" | "warmup" | "measure" | "drain" | "finalize";
  readonly pair: number;
  readonly variant: "A" | "B";
  readonly reason: string;
  readonly options: ComparisonOptions;
  readonly targetFps: number;
  readonly trials: readonly Omit<ComparisonTrial, "recording">[];
  readonly summary: ComparisonSummary;
}
export interface ComparisonReport extends Omit<ComparisonSnapshot, "trials"> {
  readonly format: "jank.js-comparison";
  readonly version: 1;
  readonly trials: readonly ComparisonTrial[];
}
export interface Comparison {
  isRunning(): boolean;
  start(options: ComparisonOptions): void;
  /** Call immediately after profiler.beginFrame, before application work; use the same timestamp and returned ID. */
  tick(atMs: number, frameId: number): void;
  cancel(reason?: string): void;
  snapshot(): ComparisonSnapshot;
  report(): ComparisonReport | null;
  /** Cancels and restores the host; never disposes the profiler or GPU resolver. */
  dispose(): void;
}
