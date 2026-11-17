import type { GpuFrame } from "../gpu/model.ts";

export type DiagnosticValues = Readonly<Record<string, number | string | boolean | null>>;

interface DiagnosticScope {
  system: string;
  label: string;
  start: number;
  end: number;
}

export interface DiagnosticFrame {
  id: number;
  /** End of the measured interval, relative to the recording clock origin. */
  at: number;
  interval: number;
  update: number;
  render: number;
  scopes: DiagnosticScope[];
  /** Legacy frame() cannot establish an exact scope-to-frame relationship. */
  coverage: "complete" | "truncated" | "unavailable";
  droppedScopes: number;
  overhead: { collectionMs: number; refreshMs: number };
}

export interface DiagnosticEvent {
  at: number;
  label: string;
  detail: string;
}

export interface DiagnosticSystem {
  id: string;
  label: string;
  cpu: number;
  peak: number;
  values: DiagnosticValues;
}

export interface FrameBudget {
  targetFps: number;
  frameMs: number;
}

interface CostSummary {
  last: number;
  mean: number;
  peak: number;
}

export interface DiagnosticOverhead {
  collection: CostSummary;
  refresh: CostSummary;
  frames: number;
  measurement: "Synchronous instrumentation and UI refresh; excludes deferred browser layout, paint and GPU work";
}

export interface RecordingEnvironment {
  userAgent: string | null;
  platform: string | null;
  hardwareConcurrency: number | null;
  viewport: { width: number; height: number; pixelRatio: number } | null;
  crossOriginIsolated: boolean | null;
  cpuTimer: {
    source: "performance.now" | "custom" | "unknown";
    estimatedResolutionMs: number | null;
    method: "minimum-observed-positive-delta" | "unavailable";
    reads: number;
  };
  gpuTimer: {
    source: "host" | "unknown";
    estimatedResolutionMs: number | null;
  };
}

export interface RecordingMetadata {
  jankVersion: string | null;
  application: { name: string; version: string | null } | null;
  createdAt: string | null;
  environment: RecordingEnvironment;
  devTools: boolean;
  importedFromVersion: number | null;
}

export interface CaptureStatus {
  mode: "manual" | "automatic" | "recent";
  state: "idle" | "armed" | "recording" | "cooldown";
  triggerFrame: number | null;
  thresholdMs: number | null;
  beforeFrames: number;
  afterFrames: number;
  cooldownMs: number;
  remainingFrames: number;
  context?: CaptureContext;
}

export interface RuleSettings {
  mode: "spike" | "sustained" | "episode";
  keep: "fixed" | "episode";
  thresholdMs: number;
  sustainedMs: number;
  quietMs: number;
  limitMs: number;
  beforeSeconds: number;
  afterSeconds: number;
  cooldownMs: number;
}

export interface CaptureRule extends RuleSettings {
  beforeFrames: number;
  afterFrames: number;
  budgetMs: number;
}

export interface CaptureContext {
  rule: CaptureRule;
  onsetFrame: number;
  onsetAt: number;
  triggerAt: number;
  endFrame: number;
  endAt: number;
  reason: "window" | "recovered" | "limit" | "capacity" | "stopped";
  crossings: number;
  beforeFrames: number;
  afterFrames: number;
}

interface RecordedGpuData {
  units: "milliseconds";
  measurement: string;
  latest: GpuProfile | null;
  samples: GpuProfile[];
}

export interface PerformanceRecording {
  format: "jank.js-recording";
  version: 2;
  units: "milliseconds";
  frameCapacity: number;
  metadata: RecordingMetadata;
  budget: FrameBudget;
  capture: CaptureStatus;
  overhead: DiagnosticOverhead;
  frames: DiagnosticFrame[];
  samples: { at: number; systems: DiagnosticSystem[] }[];
  events: DiagnosticEvent[];
  systems: DiagnosticSystem[];
  gpu?: RecordedGpuData;
  /** Explicit per-frame evidence; absent on legacy recordings. */
  gpuTiming?: { version: 1; frames: GpuFrame[] };
}

/** Timestamp-query measurements are optional and asynchronous; null is not zero. */
interface GpuPassTiming {
  label: string;
  milliseconds: number | null;
}

export interface GpuProfile {
  /** Optional explicit link to a diagnostics frame; renderer IDs alone are not sufficient. */
  diagnosticFrame?: number | null;
  available: boolean;
  enabled: boolean;
  status: "unsupported" | "disabled" | "pending" | "ready" | "error";
  /** Renderer frame at snapshot time, even while the first readback is pending. */
  currentFrame: number | null;
  sampleFrame: number | null;
  sampleAgeFrames: number | null;
  /** Span of sampled passes, including gaps; unavailable for truncation or draw-free render boundaries. */
  gpuMilliseconds: number | null;
  passes: readonly GpuPassTiming[];
  droppedFrames: number;
  truncatedPasses: number;
  error: string | null;
}
