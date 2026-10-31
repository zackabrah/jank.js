import type { Comparison } from "../comparison/comparison.ts";
import type { GpuFrameResolver } from "../core/gpu.ts";
import type { Profiler } from "../profiler.ts";
import type { GpuSource, LoadingSource, TemporalSource, VisibilitySource } from "../sources.ts";

export type PanelMode = "line" | "mini" | "full";

export interface PanelOptions {
  readonly container: HTMLElement;
  readonly profiler: Profiler;
  readonly mode?: PanelMode;
  readonly corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Enables Open viewer. Same-origin HTTP(S) transfer; other URLs fall back to a download. */
  readonly viewerUrl?: string;
  readonly gpu?: GpuSource;
  /** Host-driven comparison; closing the panel cancels its run, without disposing the controller. */
  readonly comparison?: Comparison;
  /** Borrowed interval resolver, such as the Three WebGPU adapter; used during export or viewer handoff. */
  readonly gpuResolver?: GpuFrameResolver;
  /** Bounded GPU finalization wait in milliseconds, 0–10000; defaults to 2000. */
  readonly exportTimeoutMs?: number;
  /** Stable GPU pass-ID order; unlisted passes follow in first-seen order. */
  readonly gpuPassOrder?: readonly string[];
  readonly visibility?: VisibilitySource;
  readonly temporal?: TemporalSource;
  readonly loading?: LoadingSource;
}

export interface Panel {
  /** Called from the host loop. Internally throttled; never schedules another frame loop. */
  refresh(atMs: number): void;
  setMode(mode: PanelMode): void;
  /** Releases this panel's DOM, listeners, observers and scope request, not host resources. */
  dispose(): void;
}

export type CreatePanel = (options: PanelOptions) => Panel;
