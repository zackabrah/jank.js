/** Per-pixel history policy for prepared opaque meshes. */
export type TemporalMotion = "rigid" | "reactive";

export type TemporalDebugView = "none" | "motion" | "history";

export interface TemporalDiagnostics {
  readonly objectMotion: boolean;
  readonly debugView: TemporalDebugView;
  readonly eligibleBatches: number;
  /** Batches containing valid rigid-history instances in this submission. */
  readonly rigidBatches: number;
  /** Batches containing rejected instances; mixed batches can appear in both counts. */
  readonly rejectedBatches: number;
}
