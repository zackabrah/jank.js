export const gpuIntervalLimits = { passes: 256, spanNs: 60_000_000_000 } as const;

export interface GpuPassSample {
  readonly label: string;
  readonly durationMs: number | null;
}

export interface GpuDurationSample {
  /** Explicit host correlation. Renderer frame IDs must never substitute for this. */
  readonly frameId: number | null;
  readonly rendererFrameId: number;
  readonly measurement: "pass-sum" | "elapsed-span";
  readonly durationMs: number | null;
  readonly passes: readonly GpuPassSample[];
  readonly omittedPasses: number;
}

export interface GpuIntervalPass {
  readonly id: string;
  readonly label: string;
  readonly type: "compute" | "render";
  readonly category: string | null;
  /** Distinguishes repeated invocations of the same stable pass ID. */
  readonly invocation: number;
  readonly rendererFrameId: number | null;
  readonly startNs: number;
  readonly endNs: number;
}

export interface GpuMetrics {
  readonly renderSumMs: number;
  readonly computeSumMs: number;
  readonly combinedSumMs: number;
  readonly busyMs: number;
  readonly elapsedSpanMs: number;
}

export const gpuIncompleteReasons = [
  "query-capacity",
  "queue-pressure",
  "readback-error",
  "readback-timeout",
  "missing-timestamp",
  "submission-error",
  "unclosed-frame",
  "disabled",
  "disposed",
  "device-lost",
  "ownership-lost",
] as const;
export type GpuIncompleteReason = (typeof gpuIncompleteReasons)[number];

export interface GpuIntervalSample {
  readonly measurement: "intervals";
  readonly frameId: number | null;
  readonly rendererFrameId: number;
  /** Adapter-owned application-frame sequence, independent of renderer/simulation clocks. */
  readonly sequence: number;
  readonly clock: {
    readonly id: string;
    readonly domain: "webgpu-timestamp";
    readonly unit: "nanoseconds";
    /** Decimal uint64. Pass offsets are exact safe integers relative to this GPU origin. */
    readonly originNs: string;
  };
  readonly passes: readonly GpuIntervalPass[];
  readonly expectedPasses: number;
  readonly omittedPasses: number;
  readonly completeness: "complete" | "incomplete";
  readonly issues: readonly GpuIncompleteReason[];
  /** Complete frame totals only. Partial frames keep intervals but never claim a total. */
  readonly metrics: GpuMetrics | null;
}

export type GpuSample = GpuDurationSample | GpuIntervalSample;

export interface GpuFrameResolution {
  readonly status: "settled" | "timeout" | "cancelled" | "unavailable";
  readonly samples: readonly GpuIntervalSample[];
  readonly pendingFrameIds: readonly number[];
}

export interface GpuFrameResolver {
  /** Resolves only the requested application frames; never waits in the host's frame path. */
  resolveFrames(
    frameIds: readonly number[],
    options: { readonly timeoutMs: number },
  ): Promise<GpuFrameResolution>;
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
      readonly currentFrameSequence?: number;
      readonly pendingFrames?: number;
    };

export function copyGpuSample(sample: GpuIntervalSample): GpuIntervalSample;
export function copyGpuSample(sample: GpuDurationSample): GpuDurationSample;
export function copyGpuSample(sample: GpuSample): GpuSample;
export function copyGpuSample(sample: GpuSample): GpuSample {
  if (sample.measurement === "intervals") {
    return {
      ...sample,
      clock: { ...sample.clock },
      issues: [...sample.issues],
      metrics: sample.metrics === null ? null : { ...sample.metrics },
      passes: sample.passes.map((pass) => ({ ...pass })),
    };
  }
  return { ...sample, passes: sample.passes.map((pass) => ({ ...pass })) };
}
