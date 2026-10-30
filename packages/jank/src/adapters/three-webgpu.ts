import type { GpuState } from "../core/gpu.ts";
import {
  type GpuAdapter,
  type GpuAdapterOptions,
  gpuError,
  readGpuState,
  validateFrameId,
} from "./gpu-adapter.ts";

const verifiedRevision = "186";
const maxLinkedFrames = 600;

/** Structural subset of Three r186's initialized WebGPURenderer; no Three runtime import. */
export interface ThreeTimestampRenderer {
  readonly initialized: boolean;
  readonly info: { readonly frame: number };
  readonly backend: unknown;
  hasFeature(name: string): boolean;
  resolveTimestampsAsync(type?: "render" | "compute"): Promise<number | undefined>;
}

export interface ThreeWebGpuOptions extends GpuAdapterOptions {
  readonly revision: string;
}

interface TimestampBackend {
  readonly isWebGPUBackend: true;
  trackTimestamp: boolean;
  getTimestampFrames(type: string): unknown;
  readonly device?: unknown;
}

function isTimestampBackend(value: unknown): value is TimestampBackend {
  return (
    typeof value === "object" &&
    value !== null &&
    "isWebGPUBackend" in value &&
    value.isWebGPUBackend === true &&
    "trackTimestamp" in value &&
    typeof value.trackTimestamp === "boolean" &&
    "getTimestampFrames" in value &&
    typeof value.getTimestampFrames === "function"
  );
}

function isRendererFrame(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestampFrames(backend: TimestampBackend): readonly number[] {
  const frames: unknown = backend.getTimestampFrames("render");
  if (!Array.isArray(frames) || !frames.every(isRendererFrame)) {
    throw new Error("Unexpected timestamp frame data from Three.js r186");
  }
  return frames;
}

function hasDeviceLoss(value: unknown): value is { readonly lost: PromiseLike<unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "lost" in value &&
    typeof value.lost === "object" &&
    value.lost !== null &&
    "then" in value.lost &&
    typeof value.lost.then === "function"
  );
}

/** The device promise cannot be cancelled, so disposal releases its reference to the adapter. */
function watchDeviceLoss(device: unknown, notify: () => void): () => void {
  const subscription = { notify: null as (() => void) | null };
  if (hasDeviceLoss(device)) {
    subscription.notify = notify;
    void Promise.resolve(device.lost).then(
      () => subscription.notify?.(),
      () => subscription.notify?.(),
    );
  }
  return () => {
    subscription.notify = null;
  };
}

/** Owns render timestamp resolution exclusively; Three retains all GPU buffers and queries. */
export function createThreeWebGpuSource(
  renderer: ThreeTimestampRenderer,
  options: ThreeWebGpuOptions,
): GpuAdapter {
  if (options.revision !== verifiedRevision) {
    throw new Error("The WebGPU adapter supports only the verified Three.js r186 revision");
  }
  if (!renderer.initialized) {
    throw new Error("Call await renderer.init() before creating the WebGPU timing adapter");
  }
  const backend = isTimestampBackend(renderer.backend) ? renderer.backend : null;
  const supported = backend !== null && renderer.hasFeature("timestamp-query");
  const originalTracking = backend?.trackTimestamp ?? false;
  let enabled = supported && (options.enabled ?? true);
  let lastTracking = enabled;
  let disposed = false;
  let deviceLost = false;
  let inFlight = false;
  let generation = 0;
  let boundary = -1;
  let lastResolvedFrame = backend ? (timestampFrames(backend).at(-1) ?? -1) : -1;
  let lastLinkedFrame = -1;
  let lastProfilerFrame: number | null = null;
  let currentRendererFrameId = 0;
  let droppedSamples = 0;
  const frameLinks = new Map<number, number | null>();
  let state: GpuState = idleState();
  if (supported && backend) {
    backend.trackTimestamp = enabled;
  }

  function idleState(): GpuState {
    if (!supported) {
      return {
        status: "unsupported",
        reason: "Three r186 WebGPU timestamp-query timing is unavailable",
      };
    }
    return { status: enabled ? "pending" : "disabled" };
  }

  const stopWatching = watchDeviceLoss(backend?.device, () => {
    deviceLost = true;
    enabled = false;
    generation += 1;
    frameLinks.clear();
    state = {
      status: "error",
      message: "WebGPU device lost; create a new renderer and timing adapter",
    };
  });

  function linkFrame(frameId: number | null): void {
    validateFrameId(frameId);
    const nativeFrame = renderer.info.frame;
    if (!isRendererFrame(nativeFrame) || nativeFrame < lastLinkedFrame) {
      throw new RangeError(
        "Renderer frame IDs must be nonnegative integers and must not move backwards",
      );
    }
    if (nativeFrame === lastLinkedFrame && frameId !== lastProfilerFrame) {
      throw new RangeError("This renderer frame is already linked to a different profiler frame");
    }
    lastLinkedFrame = nativeFrame;
    lastProfilerFrame = frameId;
    currentRendererFrameId = nativeFrame;
    if (nativeFrame > lastResolvedFrame) {
      frameLinks.set(nativeFrame, frameId);
    }
    if (frameLinks.size > maxLinkedFrames) {
      const oldest = frameLinks.keys().next().value;
      if (oldest !== undefined) {
        frameLinks.delete(oldest);
        droppedSamples += 1;
      }
    }
  }

  function finishLinks(sampleFrame: number): number | null {
    const frameId = frameLinks.get(sampleFrame) ?? null;
    for (const linkedFrame of frameLinks.keys()) {
      if (linkedFrame <= sampleFrame) {
        frameLinks.delete(linkedFrame);
        if (linkedFrame < sampleFrame) {
          droppedSamples += 1;
        }
      }
    }
    return frameId;
  }

  function publish(durationMs: number | undefined): void {
    if (!backend) {
      return;
    }
    // r186 returns the pass sum for the LAST frame in this list, not a whole-queue span.
    const frames = timestampFrames(backend);
    const sampleFrame = frames.at(-1);
    if (
      sampleFrame === undefined ||
      sampleFrame <= lastResolvedFrame ||
      sampleFrame <= boundary ||
      durationMs === undefined
    ) {
      return;
    }
    if (sampleFrame > currentRendererFrameId || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error("Invalid GPU timestamp result from Three.js r186");
    }
    lastResolvedFrame = sampleFrame;
    const frameId = finishLinks(sampleFrame);
    state = {
      status: "ready",
      currentRendererFrameId,
      droppedSamples,
      sample: {
        frameId,
        rendererFrameId: sampleFrame,
        measurement: "pass-sum",
        durationMs,
        passes: [{ label: "Three.js render passes (sum)", durationMs }],
        omittedPasses: 0,
      },
    };
    options.onSample?.(read());
  }

  async function resolve(epoch: number): Promise<void> {
    try {
      const durationMs = await renderer.resolveTimestampsAsync("render");
      if (!disposed && enabled && epoch === generation) {
        publish(durationMs);
      }
    } catch (cause) {
      if (!disposed && epoch === generation) {
        state = gpuError(cause);
      }
    } finally {
      inFlight = false;
    }
  }

  function read(): GpuState {
    return readGpuState(state, currentRendererFrameId, droppedSamples);
  }

  return {
    label: "Three.js r186 WebGPU render-pass timings",
    read,
    captureFrame: (frameId) => {
      if (disposed || !enabled || !backend) {
        return;
      }
      linkFrame(frameId);
      if (!backend.trackTimestamp) {
        state = { status: "error", message: "The host disabled Three.js timestamp tracking" };
        return;
      }
      if (!inFlight) {
        inFlight = true;
        void resolve(generation);
      }
    },
    setEnabled: (value) => {
      if (disposed || deviceLost || !supported || !backend || enabled === value) {
        return;
      }
      enabled = value;
      generation += 1;
      boundary = renderer.info.frame;
      frameLinks.clear();
      backend.trackTimestamp = value;
      lastTracking = value;
      state = idleState();
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      generation += 1;
      enabled = false;
      frameLinks.clear();
      stopWatching();
      if (supported && backend?.trackTimestamp === lastTracking) {
        backend.trackTimestamp = originalTracking;
      }
      state = idleState();
    },
  };
}
