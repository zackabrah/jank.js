import type {
  ChannelDescription,
  CounterSample,
  EventSample,
  FrameSample,
} from "../core/frames.ts";
import type { GpuSample } from "../core/gpu.ts";

export interface RecordingEnvironment {
  readonly userAgent: string | null;
  readonly platform: string | null;
  readonly hardwareConcurrency: number | null;
  readonly crossOriginIsolated: boolean | null;
  readonly viewport: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly pixelRatio: number;
  } | null;
  readonly timer: {
    readonly source: "performance.now" | "custom";
    readonly estimatedResolutionMs: number | null;
  };
}

export interface Recording {
  readonly format: "jank.js-recording";
  /** New field names require a new schema; never reinterpret an older file. */
  readonly schemaVersion: 4;
  readonly clock: { readonly unit: "milliseconds"; readonly origin: "profiler-start" };
  readonly metadata: {
    readonly createdAt: string;
    readonly toolVersion: string;
    readonly application: { readonly name: string; readonly version: string | null } | null;
    readonly environment: RecordingEnvironment;
  };
  readonly targetFps: number;
  readonly capture:
    | { readonly kind: "manual" | "recent" }
    | {
        readonly kind: "automatic";
        readonly triggerFrameId: number;
        readonly thresholdMs: number;
        readonly beforeFrames: number;
        readonly afterFrames: number;
      };
  readonly truncated: boolean;
  readonly frames: readonly FrameSample[];
  readonly channels: readonly ChannelDescription[];
  readonly counters: readonly CounterSample[];
  readonly events: readonly EventSample[];
  readonly gpu: readonly GpuSample[];
}

export interface RecordingProblem {
  readonly code: "invalid-json" | "unsupported-version" | "invalid-data" | "too-large";
  readonly path: string;
  readonly message: string;
}

export type RecordingResult =
  | { readonly ok: true; readonly recording: Recording }
  | { readonly ok: false; readonly problem: RecordingProblem };

export type ParseRecording = (json: string) => RecordingResult;

/** Export validates structure and the encoded byte limit; invalid caller input throws. */
export type SerializeRecording = (recording: Recording) => string;
