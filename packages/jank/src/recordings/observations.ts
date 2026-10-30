import {
  type CounterSample,
  type CounterValue,
  copyCounterSample,
  type EventSample,
  type FrameSample,
} from "../core/frames.ts";
import { copyGpuSample, type GpuSample, type GpuState } from "../core/gpu.ts";
import { recordingLimits } from "./limits.ts";
import { readCounterValues, readGpuSample } from "./read-observations.ts";
import { integer, text } from "./read-values.ts";

interface ReceivedGpu {
  readonly atMs: number;
  readonly sample: GpuSample;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, recordingLimits.detailLength) || "Provider failed";
}

/** Owns bounded optional observations for live snapshots and recording selections. */
export class ObservationHistory {
  private readonly providers = new Map<string, () => Readonly<Record<string, CounterValue>>>();
  private counterRounds: CounterSample[][] = [];
  private readonly latestCounters = new Map<string, CounterSample>();
  private events: EventSample[] = [];
  private readonly gpu = new Map<string, ReceivedGpu>();
  private gpuPassCount = 0;
  private gpuState: GpuState | null = null;
  private sampledAtMs = -Infinity;
  private droppedAtMs = -Infinity;
  private droppedGpuFrameId = 0;
  private epoch = 0;

  addChannel(id: string, read?: () => Readonly<Record<string, CounterValue>>): void {
    if (read) {
      this.providers.set(id, read);
    }
  }

  removeChannel(id: string): void {
    this.providers.delete(id);
    this.latestCounters.delete(id);
  }

  sampleCounters(atMs: number): void {
    if (atMs - this.sampledAtMs < 100) {
      return;
    }
    this.sampledAtMs = atMs;
    const epoch = this.epoch;
    const samples: CounterSample[] = [];
    for (const [channelId, read] of [...this.providers]) {
      if (this.providers.get(channelId) !== read) {
        continue;
      }
      let sample: CounterSample;
      try {
        sample = {
          atMs,
          channelId,
          status: "ready",
          values: readCounterValues(read(), "$.counter.values"),
        };
      } catch (error) {
        sample = { atMs, channelId, status: "error", message: describeError(error) };
      }
      if (epoch !== this.epoch) {
        return;
      }
      if (this.providers.get(channelId) !== read) {
        continue;
      }
      samples.push(sample);
      this.latestCounters.set(channelId, sample);
    }
    if (samples.length > 0) {
      const dropped = append(this.counterRounds, samples, recordingLimits.counterRounds)?.[0];
      if (dropped) {
        this.droppedAtMs = Math.max(this.droppedAtMs, dropped.atMs);
      }
    }
  }

  addEvent(atMs: number, label: string, detail?: string): EventSample {
    const event = {
      atMs,
      label: text(label, "$.event.label"),
      detail:
        detail === undefined ? null : text(detail, "$.event.detail", recordingLimits.detailLength),
    };
    const dropped = append(this.events, event, recordingLimits.events);
    if (dropped) {
      this.droppedAtMs = Math.max(this.droppedAtMs, dropped.atMs);
    }
    return event;
  }

  observeGpu(input: GpuState, atMs: number, knowsFrame: (id: number) => boolean): void {
    const state = validateGpuState(input);
    if (state.status !== "ready") {
      this.gpuState = state;
      return;
    }
    const sample =
      state.sample.frameId !== null && !knowsFrame(state.sample.frameId)
        ? { ...state.sample, frameId: null }
        : state.sample;
    const latest = this.gpuState?.status === "ready" ? this.gpuState.sample : null;
    if (!isOlderGpuSample(sample, latest)) {
      this.gpuState = { ...state, sample };
    }
    const key =
      sample.measurement === "intervals"
        ? `interval:${sample.clock.id}:${sample.sequence}`
        : `duration:${sample.rendererFrameId}:${sample.frameId}`;
    this.gpuPassCount += sample.passes.length - (this.gpu.get(key)?.sample.passes.length ?? 0);
    this.gpu.set(key, { atMs, sample });
    this.trimGpu();
  }

  private trimGpu(): void {
    while (
      this.gpu.size > recordingLimits.frames ||
      this.gpuPassCount > recordingLimits.gpuIntervals
    ) {
      const first = this.gpu.entries().next().value;
      if (!first) {
        return;
      }
      const [key, dropped] = first;
      this.gpu.delete(key);
      this.gpuPassCount -= dropped.sample.passes.length;
      this.droppedAtMs = Math.max(this.droppedAtMs, dropped.atMs);
      this.droppedGpuFrameId = Math.max(this.droppedGpuFrameId, dropped.sample.frameId ?? 0);
    }
  }

  snapshot(): { counters: CounterSample[]; events: EventSample[]; gpu: GpuState | null } {
    let gpu: GpuState | null = null;
    if (this.gpuState?.status === "ready") {
      gpu = { ...this.gpuState, sample: copyGpuSample(this.gpuState.sample) };
    } else if (this.gpuState !== null) {
      gpu = { ...this.gpuState };
    }
    return {
      counters: [...this.latestCounters.values()].map(copyCounterSample),
      events: this.events.map((event) => ({ ...event })),
      gpu,
    };
  }

  select(frames: readonly FrameSample[]): {
    counters: CounterSample[];
    events: EventSample[];
    gpu: GpuSample[];
    truncated: boolean;
  } {
    const first = frames[0];
    const last = frames.at(-1);
    if (!first || !last) {
      return { counters: [], events: [], gpu: [], truncated: false };
    }
    const inWindow = (sample: { readonly atMs: number }) =>
      sample.atMs >= first.startedAtMs && sample.atMs <= last.endedAtMs;
    const frameIds = new Set(frames.map((frame) => frame.id));
    return {
      counters: this.counterRounds.flat().filter(inWindow).map(copyCounterSample),
      events: this.events.filter(inWindow).map((event) => ({ ...event })),
      gpu: [...this.gpu.values()]
        .filter((entry) =>
          entry.sample.frameId === null ? inWindow(entry) : frameIds.has(entry.sample.frameId),
        )
        .map((entry) => copyGpuSample(entry.sample)),
      truncated: first.startedAtMs <= this.droppedAtMs || first.id <= this.droppedGpuFrameId,
    };
  }

  clear(): void {
    this.epoch += 1;
    this.counterRounds = [];
    this.latestCounters.clear();
    this.events = [];
    this.gpu.clear();
    this.gpuPassCount = 0;
    this.gpuState = null;
    this.sampledAtMs = -Infinity;
    this.droppedAtMs = -Infinity;
    this.droppedGpuFrameId = 0;
  }

  dispose(): void {
    this.clear();
    this.providers.clear();
  }
}

function append<T>(items: T[], item: T, capacity: number): T | undefined {
  items.push(item);
  return items.length > capacity ? items.shift() : undefined;
}

function validateGpuState(state: GpuState): GpuState {
  switch (state.status) {
    case "disabled":
    case "pending":
      return { status: state.status };
    case "unsupported":
      return { status: "unsupported", reason: text(state.reason, "$.gpu.reason") };
    case "error":
      return {
        status: "error",
        message: text(state.message, "$.gpu.message", recordingLimits.detailLength),
      };
    case "ready": {
      const sample = readGpuSample(state.sample, "$.gpu.sample");
      return {
        status: "ready",
        sample,
        currentRendererFrameId: integer(
          state.currentRendererFrameId,
          "$.gpu.currentRendererFrameId",
          sample.rendererFrameId,
        ),
        droppedSamples: integer(state.droppedSamples, "$.gpu.droppedSamples"),
        ...(state.currentFrameSequence === undefined
          ? {}
          : {
              currentFrameSequence: integer(
                state.currentFrameSequence,
                "$.gpu.currentFrameSequence",
                sample.measurement === "intervals" ? sample.sequence : 0,
              ),
            }),
        ...(state.pendingFrames === undefined
          ? {}
          : { pendingFrames: integer(state.pendingFrames, "$.gpu.pendingFrames") }),
      };
    }
    default:
      throw new Error("Unknown GPU status");
  }
}

function isOlderGpuSample(sample: GpuSample, latest: GpuSample | null): boolean {
  return (
    sample.measurement === "intervals" &&
    latest?.measurement === "intervals" &&
    sample.clock.id === latest.clock.id &&
    sample.sequence < latest.sequence
  );
}
