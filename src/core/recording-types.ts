import type { GpuProfile } from "../types/gpu-profile-types.ts";

export type DiagnosticValues = Readonly<
  Record<string, number | string | boolean | null>
>;

export interface DiagnosticScope {
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

export interface CostSummary {
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

export interface AutoCaptureOptions {
  thresholdMs?: number;
  beforeFrames?: number;
  afterFrames?: number;
  cooldownMs?: number;
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
}

export interface RecordedGpuData {
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
}

export interface DiagnosticSnapshot {
  frames: DiagnosticFrame[];
  systems: DiagnosticSystem[];
  events: DiagnosticEvent[];
  recording: boolean;
  recordedFrames: number;
  budget: FrameBudget;
  capture: CaptureStatus;
  overhead: DiagnosticOverhead;
}
