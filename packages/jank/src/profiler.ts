import type { CounterValue, ScopeSample } from "./core/frames.ts";
import type { GpuState } from "./core/gpu.ts";
import type { ProfilerSnapshot } from "./core/snapshot.ts";
import type { CaptureController } from "./recordings/capture.ts";

declare const scopeToken: unique symbol;

/** An opaque numeric handle, not a timestamp. Only Channel.begin creates it. */
export type ScopeToken = number & { readonly [scopeToken]: true };

export interface Channel {
  begin(): ScopeToken;
  end(token: ScopeToken): void;
  dispose(): void;
}

export interface ChannelOptions {
  readonly id: string;
  readonly label: string;
  readonly readCounters?: () => Readonly<Record<string, CounterValue>>;
}

export interface TraceSink {
  writeScope(scope: ScopeSample): void;
  writeEvent(event: { readonly atMs: number; readonly label: string }): void;
}

export interface ProfilerOptions {
  /** Monotonic milliseconds. beginFrame timestamps must use this same clock. */
  readonly now?: () => number;
  readonly targetFps?: number;
  readonly maxScopesPerFrame?: number;
  readonly application?: { readonly name: string; readonly version?: string };
  /** Borrowed: disposing the profiler does not dispose the host's trace sink. */
  readonly trace?: TraceSink;
}

export interface Profiler {
  readonly capture: CaptureController;
  /** Seals the previous frame, opens this frame, and returns its stable ID. */
  beginFrame(atMs: number): number;
  /** Optional host CPU totals; this does not manufacture a frame's ending boundary. */
  endFrame(cpu: { readonly updateMs: number; readonly renderMs: number }): void;
  createChannel(options: ChannelOptions): Channel;
  addEvent(label: string, detail?: string): void;
  observeGpu(state: GpuState): void;
  setTargetFps(targetFps: number): void;
  setTraceEnabled(enabled: boolean): void;
  /** Independent demand for CPU scopes. Release only this caller's demand. */
  requestScopes(): () => void;
  measureRefresh<T>(render: () => T): T;
  snapshot(): ProfilerSnapshot;
  /** Clears samples and capture state; frame IDs remain monotonic for late GPU results. */
  clear(): void;
  dispose(): void;
}

export type CreateProfiler = (options?: ProfilerOptions) => Profiler;
