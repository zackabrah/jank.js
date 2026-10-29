export interface GpuPassSample {
  readonly label: string;
  readonly durationMs: number | null;
}

export interface GpuSample {
  /** Explicit host correlation. Renderer frame IDs must never substitute for this. */
  readonly frameId: number | null;
  readonly rendererFrameId: number;
  readonly measurement: "pass-sum" | "elapsed-span";
  readonly durationMs: number | null;
  readonly passes: readonly GpuPassSample[];
  readonly omittedPasses: number;
}

export type GpuState =
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "disabled" }
  | { readonly status: "pending" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly currentRendererFrameId: number;
      readonly sample: GpuSample;
      readonly droppedSamples: number;
    };
