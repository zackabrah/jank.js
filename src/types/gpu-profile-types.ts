/** Timestamp-query measurements are optional and asynchronous; null is not zero. */
export interface GpuPassTiming {
  label: string;
  milliseconds: number | null;
}

export interface GpuProfile {
  /** Optional explicit link to a diagnostics frame; renderer IDs alone are not sufficient. */
  diagnosticFrame?: number | null;
  available: boolean;
  enabled: boolean;
  status: "unsupported" | "disabled" | "pending" | "ready" | "error";
  /** Renderer frame at snapshot time, even while the first readback is pending. */
  currentFrame: number | null;
  sampleFrame: number | null;
  sampleAgeFrames: number | null;
  /** Span of sampled passes, including gaps; unavailable for truncation or draw-free render boundaries. */
  gpuMilliseconds: number | null;
  passes: readonly GpuPassTiming[];
  droppedFrames: number;
  truncatedPasses: number;
  error: string | null;
}
