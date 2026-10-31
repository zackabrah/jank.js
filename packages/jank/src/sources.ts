import type { GpuState } from "./core/gpu.ts";
import type { LoadingSnapshot } from "./loading/loading.ts";

export interface GpuSource {
  readonly label: string;
  read(): GpuState;
  setEnabled(enabled: boolean): void;
}

export interface VisibilityView {
  readonly name: string;
  readonly tested: number;
  readonly visible: number;
  readonly culled: number;
}

export interface VisibilitySnapshot {
  readonly note?: string;
  readonly enabled: boolean;
  readonly debugBounds: boolean;
  readonly views: readonly VisibilityView[];
  readonly distance: { readonly range: number | null; readonly culled: number } | null;
  readonly instances: {
    readonly enabled: boolean;
    readonly hierarchies: number;
    readonly nodes: number;
    readonly prepared: number;
    readonly cacheHits: number;
    readonly views: readonly {
      readonly name: string;
      readonly candidates: number;
      readonly visible: number;
      readonly culled: number;
      readonly rejectedLeaves: number;
      readonly sampleAgeFrames: number | null;
    }[];
  } | null;
}

export interface VisibilitySource {
  read(): VisibilitySnapshot | null;
  setEnabled(enabled: boolean): void;
  setDebugBounds(enabled: boolean): void;
  setInstancesEnabled?(enabled: boolean): void;
}

export interface TemporalSnapshot {
  readonly note?: string;
  readonly objectMotion: boolean;
  readonly debugView: "none" | "motion" | "history";
  readonly eligibleBatches: number;
  readonly rigidBatches: number;
  readonly rejectedBatches: number;
}

export interface TemporalSource {
  read(): TemporalSnapshot | null;
  setEnabled(enabled: boolean): void;
  setDebugView(view: TemporalSnapshot["debugView"]): void;
}

export interface LoadingSource {
  /** Optional retained first successful cold run; older sources fall back to history. */
  baseline?(): LoadingSnapshot | null;
  snapshot(): LoadingSnapshot | null;
  history(): readonly LoadingSnapshot[];
}
