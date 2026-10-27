type Vec3 = readonly [number, number, number];

/** Per-view draw-batch visibility decisions from the most recently encoded frame. */
export interface CullingViewStats {
  readonly tested: number;
  readonly visible: number;
  readonly culled: number;
}

/** Conservative world AABB sampled for the main view's bounded editor overlay. */
export interface CullingBounds {
  readonly label: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly culled: boolean;
}

export interface CullingDiagnostics {
  /** Bounded mesh batches rejected from main and reflection submission by the host range. */
  readonly distance?: {
    readonly range: number | null;
    readonly culled: number;
  };
  /** Asynchronous GPU counts. CPU draw/triangle counters remain submission upper bounds. */
  readonly instances?: {
    readonly enabled: boolean;
    readonly hierarchies: number;
    readonly nodes: number;
    readonly prepared: number;
    readonly cacheHits: number;
    readonly views: readonly {
      readonly view: string;
      readonly candidates: number;
      readonly visible: number;
      readonly culled: number;
      readonly rejectedLeaves: number;
      readonly sampleAgeFrames: number | null;
    }[];
  };
  readonly enabled: boolean;
  readonly debugBounds: boolean;
  readonly main: CullingViewStats;
  readonly shadow: CullingViewStats;
  readonly reflection: CullingViewStats;
  readonly bounds: readonly CullingBounds[];
  readonly boundsOmitted: number;
  /** Unjittered, unpadded main world-to-clip matrix, copied only for debug bounds. */
  readonly viewProjection: readonly number[] | null;
}
