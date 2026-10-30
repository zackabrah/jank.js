import type { ChannelDescription, CounterSample, EventSample, FrameSample } from "./frames.ts";
import type { GpuState } from "./gpu.ts";

export interface CostSummary {
  readonly latestMs: number;
  readonly averageMs: number;
  readonly peakMs: number;
}

/** Detached data. Reading does not reset measurements or consume a recording. */
export interface FrameSnapshot {
  readonly scopesRequested: boolean;
  readonly targetFps: number;
  readonly frames: readonly FrameSample[];
  readonly channels: readonly ChannelDescription[];
  readonly overhead: {
    readonly collection: CostSummary;
    readonly refresh: CostSummary;
  };
}

export interface ProfilerSnapshot extends FrameSnapshot {
  readonly traceEnabled: boolean;
  /** Latest observation per active counter provider. Recordings retain the sampling history. */
  readonly counters: readonly CounterSample[];
  readonly events: readonly EventSample[];
  readonly gpu: GpuState | null;
}
