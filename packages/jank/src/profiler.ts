import type { Channel } from "./core/channels.ts";
import { createFrameCollector } from "./core/collector.ts";
import type { CounterValue, ScopeSample } from "./core/frames.ts";
import type { GpuState } from "./core/gpu.ts";
import type { ProfilerSnapshot } from "./core/snapshot.ts";
import type { CaptureController } from "./recordings/capture.ts";
import { createCaptureController } from "./recordings/controller.ts";
import { describeError, ObservationHistory } from "./recordings/observations.ts";
import type { Recording } from "./recordings/recording.ts";

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
  /** Seals the previous frame and opens this one. -1 skips a pre-creation boundary or disposed profiler. */
  beginFrame(atMs: number): number;
  /** Optional host CPU totals; this does not manufacture a frame's ending boundary. */
  endFrame(cpu: { readonly updateMs: number; readonly renderMs: number }): void;
  createChannel(options: ChannelOptions): Channel;
  addEvent(label: string, detail?: string): void;
  observeGpu(state: GpuState): void;
  setTargetFps(targetFps: number): void;
  setTraceEnabled(enabled: boolean): void;
  /** Independent scope demand, effective next frame. Release only this caller's demand. */
  requestScopes(): () => void;
  measureRefresh<T>(render: () => T): T;
  snapshot(): ProfilerSnapshot;
  /** Clears samples and capture state; frame IDs remain monotonic for late GPU results. */
  clear(): void;
  dispose(): void;
}

export type CreateProfiler = (options?: ProfilerOptions) => Profiler;

export function createProfilerRuntime(
  options: ProfilerOptions & { readonly now: () => number },
  environment: { readonly costNow: () => number; readonly metadata: () => Recording["metadata"] },
): Profiler {
  const collector = createFrameCollector({ ...options, costNow: environment.costNow });
  const observations = new ObservationHistory();
  let disposed = false;
  let openedFrameId = -1;
  let releaseTrace: (() => void) | null = null;
  const capture = createCaptureController({
    recentFrames: () => collector.recentFrames(),
    requestScopes: () => collector.requestScopes(),
    createRecording: (frames, kind, truncated) => {
      const selected = observations.select(frames);
      const snapshot = collector.snapshot();
      return {
        format: "jank.js-recording",
        schemaVersion: 4,
        clock: { unit: "milliseconds", origin: "profiler-start" },
        metadata: environment.metadata(),
        targetFps: snapshot.targetFps,
        capture: kind,
        channels: snapshot.channels,
        frames,
        ...selected,
        truncated: truncated || selected.truncated,
      };
    },
  });

  function setTraceEnabled(enabled: boolean): void {
    if (disposed) {
      return;
    }
    if (!enabled) {
      releaseTrace?.();
      releaseTrace = null;
      collector.observeScopes(null);
    } else if (releaseTrace === null) {
      const sink = options.trace;
      if (!sink) {
        throw new Error("A trace sink must be supplied before tracing can be enabled");
      }
      releaseTrace = collector.requestScopes();
      collector.observeScopes((scope) => {
        try {
          sink.writeScope(scope);
        } catch (error) {
          traceFailed(error);
        }
      });
    }
  }

  function traceFailed(error: unknown): void {
    setTraceEnabled(false);
    observations.addEvent(collector.time(), "Trace disabled", describeError(error));
  }

  return {
    capture: {
      getState: () => capture.getState(),
      getOptions: () => capture.getOptions(),
      start: () => collector.measureCollection(() => capture.start()),
      stop: () => collector.measureCollection(() => capture.stop()),
      arm: (value) => collector.measureCollection(() => capture.arm(value)),
      disarm: () => collector.measureCollection(() => capture.disarm()),
      recent: () => collector.measureCollection(() => capture.recent()),
      list: () => collector.measureCollection(() => capture.list()),
      read: (id) => collector.measureCollection(() => capture.read(id)),
      completed: () => collector.measureCollection(() => capture.completed()),
    },
    beginFrame: (atMs) =>
      collector.measureCollection(() => {
        const id = collector.beginFrame(atMs);
        if (id < 0 || id === openedFrameId) {
          return id;
        }
        openedFrameId = id;
        const sealed = collector.takeSealedFrame();
        if (sealed) {
          capture.accept(sealed);
        }
        observations.sampleCounters(collector.time());
        return id;
      }),
    endFrame: (cpu) => collector.endFrame(cpu),
    createChannel: (configuration) => {
      const channel = collector.createChannel(configuration);
      const id = configuration.id;
      let active = true;
      observations.addChannel(id, configuration.readCounters);
      return {
        begin: () => channel.begin(),
        end: (token) => channel.end(token),
        dispose: () => {
          if (active) {
            active = false;
            channel.dispose();
            observations.removeChannel(id);
          }
        },
      };
    },
    addEvent: (label, detail) =>
      collector.measureCollection(() => {
        if (disposed) {
          return;
        }
        const event = observations.addEvent(collector.time(), label, detail);
        if (releaseTrace !== null) {
          try {
            options.trace?.writeEvent({ atMs: event.atMs, label: event.label });
          } catch (error) {
            traceFailed(error);
          }
        }
      }),
    observeGpu: (state) =>
      collector.measureCollection(() => {
        if (!disposed) {
          observations.observeGpu(state, collector.time(), (id) => collector.knowsFrame(id));
        }
      }),
    setTargetFps: (value) => collector.setTargetFps(value),
    setTraceEnabled,
    requestScopes: () => collector.requestScopes(),
    measureRefresh: (render) => collector.measureRefresh(render),
    snapshot: () =>
      collector.measureCollection(() => ({
        ...collector.snapshot(),
        ...observations.snapshot(),
        traceEnabled: releaseTrace !== null,
      })),
    clear: () => {
      capture.clear();
      observations.clear();
      collector.clear();
    },
    dispose: () => {
      if (!disposed) {
        setTraceEnabled(false);
        disposed = true;
        capture.dispose();
        observations.dispose();
        collector.dispose();
      }
    },
  };
}
