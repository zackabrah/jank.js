import { copyGpuSample, type GpuState } from "../core/gpu.ts";
import type { GpuSource } from "../sources.ts";

export interface GpuAdapterOptions {
  readonly enabled?: boolean;
  /** Receives each completed sample, including multiple results resolved in one host frame. */
  readonly onSample?: (state: GpuState) => void;
}

export interface GpuAdapter extends GpuSource {
  /** Call after rendering. The profiler frame ID is independent of the renderer's frame ID. */
  captureFrame(frameId: number | null): void;
  /** Releases only adapter-owned state; the host retains its renderer/context. */
  dispose(): void;
}

export function validateFrameId(frameId: number | null): void {
  if (frameId !== null && (!Number.isSafeInteger(frameId) || frameId < 1)) {
    throw new RangeError("A profiler frame ID must be a positive integer or null");
  }
}

export function readGpuState(
  state: GpuState,
  currentRendererFrameId: number,
  droppedSamples: number,
): GpuState {
  return state.status === "ready"
    ? { ...state, currentRendererFrameId, droppedSamples, sample: copyGpuSample(state.sample) }
    : { ...state };
}

export function gpuError(cause: unknown): GpuState {
  const message = cause instanceof Error ? cause.message : String(cause);
  return { status: "error", message: message.slice(0, 2000) || "GPU timing failed" };
}
