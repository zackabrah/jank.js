import type { Profiler } from "../profiler.ts";
import type { GpuSource, LoadingSource, TemporalSource, VisibilitySource } from "../sources.ts";

export type PanelMode = "line" | "mini" | "full";

export interface PanelOptions {
  readonly container: HTMLElement;
  readonly profiler: Profiler;
  readonly mode?: PanelMode;
  readonly corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  readonly viewerUrl?: string;
  readonly gpu?: GpuSource;
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
