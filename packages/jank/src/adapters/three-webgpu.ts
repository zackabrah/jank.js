import {
  copyGpuSample,
  type GpuFrameResolution,
  type GpuFrameResolver,
  type GpuIncompleteReason,
  type GpuIntervalSample,
  type GpuState,
  gpuIntervalLimits,
} from "../core/gpu.ts";
import {
  type GpuAdapter,
  type GpuAdapterOptions,
  gpuError,
  validateFrameId,
} from "./gpu-adapter.ts";
import { finishGpuFrame, type GpuFrameTiming } from "./gpu-interval-frame.ts";
import { isTimestampBackend, ownThreeTimestamps } from "./three-timestamp-owner.ts";
import { createTimestampSlot, TimestampReadError, type TimestampSlot } from "./webgpu-readback.ts";

export interface ThreeTimestampRenderer {
  readonly initialized: boolean;
  readonly info: { readonly frame: number };
  readonly backend: unknown;
  hasFeature(name: string): boolean;
}

export interface GpuPassDescription {
  readonly id: string;
  readonly label: string;
  readonly category?: string;
}

export interface ThreeWebGpuOptions extends GpuAdapterOptions {
  readonly revision: string;
  /** Off by default. Attaching does not request instrumentation. */
  readonly enabled?: boolean;
  readonly maxPasses?: number;
  readonly maxPendingFrames?: number;
  readonly readbackTimeoutMs?: number;
  /** Collect one bracket in every N; skipped frames remain explicitly marked. Default 1. */
  readonly sampleEveryNFrames?: number;
}

export interface ThreeWebGpuSource extends GpuAdapter, GpuFrameResolver {
  /** Open before the first compute/render call for this application frame. */
  beginFrame(frameId: number | null): void;
  /** Submit readback after the last render/compute call; returns immediately. */
  endFrame(): void;
  /** Labels every native pass submitted synchronously within this callback. Nesting is allowed. */
  withPass(description: GpuPassDescription, submit: () => void): void;
  diagnostics(): {
    readonly pendingFrames: number;
    readonly retainedFrames: number;
    readonly allocatedSlots: number;
    readonly bufferBytes: number;
  };
}

interface ActiveFrame {
  readonly timing: GpuFrameTiming;
  readonly slot: TimestampSlot | null;
}
interface PendingFrame extends ActiveFrame {
  readonly promise: Promise<void>;
}

export function createThreeWebGpuSource(
  renderer: ThreeTimestampRenderer,
  options: ThreeWebGpuOptions,
): ThreeWebGpuSource {
  if (options.revision !== "186") {
    throw new Error("GPU intervals support only the verified Three.js r186 revision");
  }
  if (!renderer.initialized) {
    throw new Error("Call await renderer.init() before attaching GPU timing");
  }
  const limits = {
    passes: boundedInteger(
      options.maxPasses ?? gpuIntervalLimits.passes,
      1,
      gpuIntervalLimits.passes,
      "maxPasses",
    ),
    pending: boundedInteger(options.maxPendingFrames ?? 4, 1, 8, "maxPendingFrames"),
    timeoutMs: boundedInteger(options.readbackTimeoutMs ?? 2000, 1, 10_000, "readbackTimeoutMs"),
    sampleEveryNFrames: boundedInteger(
      options.sampleEveryNFrames ?? 1,
      1,
      6000,
      "sampleEveryNFrames",
    ),
  };
  return new ThreeGpuSession(renderer, options, limits);
}

class ThreeGpuSession implements ThreeWebGpuSource {
  readonly label = "Three.js r186 compute and render GPU intervals";
  private readonly renderer: ThreeTimestampRenderer;
  private readonly options: ThreeWebGpuOptions;
  private readonly limits: {
    passes: number;
    pending: number;
    timeoutMs: number;
    sampleEveryNFrames: number;
  };
  private readonly owner: ReturnType<typeof ownThreeTimestamps> | null;
  private readonly clockId = crypto.randomUUID();
  private enabled = false;
  private disposed = false;
  private fatal = false;
  private generation = 0;
  private sequence = 0;
  private latestSequence = 0;
  private lastFrameId = 0;
  private rendererFrameId = 0;
  private droppedSamples = 0;
  private active: ActiveFrame | null = null;
  private passLabel: GpuPassDescription | null = null;
  private slots: TimestampSlot[] = [];
  private readonly pending = new Map<number, PendingFrame>();
  private readonly retained = new Map<number, GpuIntervalSample>();
  private state: GpuState = { status: "disabled" };
  private resolvingFrames = false;

  constructor(
    renderer: ThreeTimestampRenderer,
    options: ThreeWebGpuOptions,
    limits: ThreeGpuSession["limits"],
  ) {
    this.renderer = renderer;
    this.options = { ...options };
    this.limits = limits;
    const backend = isTimestampBackend(renderer.backend) ? renderer.backend : null;
    this.owner =
      backend && renderer.hasFeature("timestamp-query")
        ? ownThreeTimestamps(
            backend,
            (type, uid, descriptor) => this.writePass(type, uid, descriptor),
            () => this.deviceLost(),
          )
        : null;
    if (!this.owner) {
      this.state = {
        status: "unsupported",
        reason: "Three r186 WebGPU timestamp-query timing is unavailable",
      };
    } else {
      this.setEnabled(options.enabled ?? false);
    }
  }

  beginFrame(frameId: number | null): void {
    if (!this.usable()) {
      return;
    }
    validateFrameId(frameId);
    if (this.active) {
      this.active.timing.issues.add("unclosed-frame");
      throw new Error("Call endFrame before beginning another GPU frame");
    }
    if (frameId !== null && frameId <= this.lastFrameId) {
      throw new RangeError(
        "Application frame IDs must increase; replace the adapter when replacing the profiler",
      );
    }
    this.lastFrameId = frameId ?? this.lastFrameId;
    this.sequence += 1;
    const timing: GpuFrameTiming = {
      frameId,
      sequence: this.sequence,
      rendererFrameId: nativeFrame(this.renderer.info.frame) ?? 0,
      expectedPasses: 0,
      passes: [],
      issues: new Set(),
    };
    this.rendererFrameId = Math.max(this.rendererFrameId, timing.rendererFrameId);
    if ((this.sequence - 1) % this.limits.sampleEveryNFrames !== 0) {
      timing.issues.add("sampled-out");
      this.active = { timing, slot: null };
      return;
    }
    let slot: TimestampSlot | null = null;
    try {
      slot = this.availableSlot();
    } catch (cause) {
      timing.issues.add("readback-error");
      this.state = gpuError(cause);
    }
    if (!slot && timing.issues.size === 0) {
      timing.issues.add("queue-pressure");
    }
    this.active = { timing, slot };
  }

  private availableSlot(): TimestampSlot | null {
    if (!this.owner) {
      return null;
    }
    this.slots = this.slots.filter((slot) => !slot.disposed);
    const occupied = new Set([...this.pending.values()].map((entry) => entry.slot));
    const idle = this.slots.find((slot) => !occupied.has(slot));
    if (idle) {
      return idle;
    }
    if (this.slots.length >= this.limits.pending) {
      return null;
    }
    const slot = createTimestampSlot(this.owner.device, this.limits.passes);
    this.slots.push(slot);
    return slot;
  }

  private writePass(type: unknown, uid: unknown, descriptor: object): void {
    const frame = this.active;
    if (!frame || !this.usable()) {
      return;
    }
    if ((type !== "render" && type !== "compute") || typeof uid !== "string") {
      frame.timing.issues.add("submission-error");
      this.state = gpuError("Unexpected Three r186 timestamp invocation");
      return;
    }
    const timing = frame.timing;
    timing.expectedPasses += 1;
    if (Reflect.get(descriptor, "timestampWrites") !== undefined) {
      timing.issues.add("ownership-lost");
      return;
    }
    const frameId = rendererFrame(uid) ?? nativeFrame(this.renderer.info.frame);
    timing.rendererFrameId = Math.max(timing.rendererFrameId, frameId ?? 0);
    this.rendererFrameId = Math.max(this.rendererFrameId, timing.rendererFrameId);
    if (!frame.slot) {
      return;
    }
    if (timing.passes.length === this.limits.passes) {
      timing.issues.add("query-capacity");
      return;
    }
    const context = uid.replace(/^[cr]:\d+:/u, "").replace(/:f\d+$/u, "") || "unlabelled";
    const label = this.passLabel ?? {
      id: `${type}:${context}`.slice(0, 240),
      label: `${type} ${context}`.slice(0, 240),
    };
    const offset = timing.passes.length * 2;
    timing.passes.push({
      id: label.id,
      label: label.label,
      category: label.category ?? null,
      type,
      invocation: timing.expectedPasses,
      rendererFrameId: frameId,
    });
    Object.defineProperty(descriptor, "timestampWrites", {
      value: {
        querySet: frame.slot.querySet,
        beginningOfPassWriteIndex: offset,
        endOfPassWriteIndex: offset + 1,
      },
      configurable: true,
    });
  }

  withPass(description: GpuPassDescription, submit: () => void): void {
    validateLabel(description);
    const previous = this.passLabel;
    this.passLabel = { ...description };
    try {
      const result: unknown = submit();
      if (typeof result === "object" && result !== null && "then" in result) {
        void Promise.resolve(result).catch(() => {});
        throw new Error(
          "GPU pass submission must be synchronous; initialize resources before the frame loop",
        );
      }
    } catch (cause) {
      this.active?.timing.issues.add("submission-error");
      throw cause;
    } finally {
      this.passLabel = previous;
    }
  }

  captureFrame(frameId: number | null): void {
    if (!this.usable()) {
      return;
    }
    if (!this.active) {
      throw new Error("Call beginFrame before GPU work, then captureFrame or endFrame afterward");
    }
    if (frameId !== this.active.timing.frameId) {
      throw new Error("GPU frame association changed within a frame");
    }
    this.endFrame();
  }

  endFrame(): void {
    const frame = this.active;
    if (!frame || !this.usable()) {
      return;
    }
    this.active = null;
    if (frame.slot && frame.timing.passes.length > 0) {
      const promise = this.resolve(frame, this.generation);
      this.pending.set(frame.timing.sequence, { ...frame, promise });
    } else {
      this.publish(finishGpuFrame(frame.timing, new BigUint64Array(), this.clockId));
    }
  }

  private async resolve(frame: ActiveFrame, epoch: number): Promise<void> {
    try {
      if (!frame.slot) {
        return;
      }
      const times = await frame.slot.read(frame.timing.passes.length, this.limits.timeoutMs);
      this.pending.delete(frame.timing.sequence);
      if (epoch === this.generation && !this.disposed) {
        this.publish(finishGpuFrame(frame.timing, times, this.clockId));
      }
    } catch (cause) {
      this.pending.delete(frame.timing.sequence);
      if (epoch === this.generation && !this.disposed) {
        frame.timing.issues.add(
          cause instanceof TimestampReadError ? cause.reason : "readback-error",
        );
        this.publish(finishGpuFrame(frame.timing, new BigUint64Array(), this.clockId));
        this.state = gpuError(cause);
      }
    }
  }

  private retain(sample: GpuIntervalSample): void {
    this.retained.set(sample.sequence, sample);
    if (this.retained.size > 128) {
      this.retained.delete(Math.min(...this.retained.keys()));
    }
  }

  private publish(sample: GpuIntervalSample): void {
    this.retain(sample);
    if (sample.issues.some((issue) => issue !== "sampled-out")) {
      this.droppedSamples += 1;
    }
    const state: GpuState = {
      status: "ready",
      sample: copyGpuSample(sample),
      currentRendererFrameId: this.rendererFrameId,
      currentFrameSequence: this.sequence,
      pendingFrames: this.pending.size,
      droppedSamples: this.droppedSamples,
    };
    if (sample.sequence >= this.latestSequence) {
      this.latestSequence = sample.sequence;
      this.state = state;
    }
    try {
      this.options.onSample?.({ ...state, sample: copyGpuSample(sample) });
    } catch (cause) {
      this.state = gpuError(cause);
    }
  }

  read(): GpuState {
    return this.state.status === "ready"
      ? {
          ...this.state,
          sample: copyGpuSample(this.state.sample),
          currentFrameSequence: this.sequence,
          currentRendererFrameId: this.rendererFrameId,
          pendingFrames: this.pending.size,
          droppedSamples: this.droppedSamples,
        }
      : { ...this.state };
  }

  private usable(): boolean {
    if (this.disposed || !this.enabled || this.fatal || !this.owner) {
      return false;
    }
    if (!this.owner.intact()) {
      this.cancelPending("ownership-lost");
      this.fatal = true;
      this.state = gpuError(
        "The host changed Jank's timestamp ownership; dispose and reattach the adapter",
      );
      return false;
    }
    return true;
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || this.fatal || !this.owner || this.enabled === enabled) {
      return;
    }
    this.cancelPending("disabled");
    this.enabled = enabled;
    this.owner.enable(enabled);
    this.state = { status: enabled ? "pending" : "disabled" };
  }

  private cancelPending(reason: GpuIncompleteReason): void {
    this.generation += 1;
    const frames: ActiveFrame[] = [...this.pending.values()];
    if (this.active) {
      frames.push(this.active);
    }
    for (const frame of frames) {
      frame.timing.issues.add(reason);
      this.retain(finishGpuFrame(frame.timing, new BigUint64Array(), this.clockId));
      this.droppedSamples += 1;
    }
    this.active = null;
    this.pending.clear();
    for (const slot of this.slots) {
      slot.dispose();
    }
    this.slots = [];
  }

  private deviceLost(): void {
    if (this.disposed) {
      return;
    }
    this.cancelPending("device-lost");
    this.fatal = true;
    this.enabled = false;
    this.state = gpuError("WebGPU device lost; create a new renderer and timing adapter");
  }

  async resolveFrames(
    frameIds: readonly number[],
    options: { readonly timeoutMs: number },
  ): Promise<GpuFrameResolution> {
    boundedInteger(options.timeoutMs, 0, 10_000, "timeoutMs");
    if (frameIds.length > 6000) {
      throw new RangeError("At most 6000 GPU frames may be finalized");
    }
    for (const frameId of frameIds) {
      validateFrameId(frameId);
    }
    if (this.resolvingFrames) {
      throw new Error("A GPU frame finalization is already pending");
    }
    const requested = new Set(frameIds);
    if (
      this.active?.timing.frameId !== null &&
      this.active &&
      requested.has(this.active.timing.frameId)
    ) {
      throw new Error("Call endFrame before finalizing that GPU frame");
    }
    const epoch = this.generation;
    const pending = [...this.pending.values()].filter(
      (entry) => entry.timing.frameId !== null && requested.has(entry.timing.frameId),
    );
    this.resolvingFrames = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let status: GpuFrameResolution["status"] = "settled";
    try {
      if (pending.length > 0) {
        status = await Promise.race([
          Promise.all(pending.map((entry) => entry.promise)).then(() => "settled" as const),
          new Promise<"timeout">((resolve) => {
            timeout = setTimeout(() => resolve("timeout"), options.timeoutMs);
          }),
        ]);
      }
      if (this.disposed || epoch !== this.generation) {
        status = "cancelled";
      }
      if (!this.owner) {
        status = "unavailable";
      }
      return {
        status,
        samples: [...this.retained.values()]
          .filter((sample) => sample.frameId !== null && requested.has(sample.frameId))
          .sort((a, b) => a.sequence - b.sequence)
          .map((sample) => copyGpuSample(sample)),
        pendingFrameIds: [...this.pending.values()].flatMap((entry) =>
          entry.timing.frameId !== null && requested.has(entry.timing.frameId)
            ? [entry.timing.frameId]
            : [],
        ),
      };
    } finally {
      clearTimeout(timeout);
      this.resolvingFrames = false;
    }
  }

  diagnostics(): ReturnType<ThreeWebGpuSource["diagnostics"]> {
    const allocatedSlots = this.slots.filter((slot) => !slot.disposed).length;
    return {
      pendingFrames: this.pending.size,
      retainedFrames: this.retained.size,
      allocatedSlots,
      bufferBytes: allocatedSlots * this.limits.passes * 32,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelPending("disposed");
    this.enabled = false;
    this.owner?.dispose();
    this.retained.clear();
    this.state = this.owner ? { status: "disabled" } : this.state;
  }
}

function nativeFrame(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function rendererFrame(uid: string): number | null {
  const match = /:f(\d+)$/u.exec(uid);
  return match ? nativeFrame(Number(match[1])) : null;
}
function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
function validateLabel(description: GpuPassDescription): void {
  for (const label of [
    description.id,
    description.label,
    description.category ?? "uncategorized",
  ]) {
    if (typeof label !== "string" || !label.trim() || label.length > 240) {
      throw new RangeError("GPU pass IDs, labels and categories must contain 1–240 characters");
    }
  }
}
