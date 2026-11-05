import type { ThreeBackend } from "./three-renderer.ts";

export interface StressSettings {
  cpuMs: number;
  instances: number;
  passes: number;
  resolution: number;
}

export const stressPresets = {
  Baseline: { cpuMs: 0, instances: 144, passes: 1, resolution: 1 },
  "CPU stress": { cpuMs: 14, instances: 144, passes: 1, resolution: 1 },
  "GPU stress": { cpuMs: 0, instances: 1024, passes: 4, resolution: 1.5 },
  Mixed: { cpuMs: 10, instances: 512, passes: 3, resolution: 1.25 },
} satisfies Record<string, StressSettings>;

export const comparisonCandidates = ["CPU stress", "GPU stress", "Mixed"] as const;
export type ComparisonCandidate = (typeof comparisonCandidates)[number];

/**
 * Baseline against one preset. The first differing setting is the change under test, so a preset
 * that changes several settings reports the rest as confounds instead of hiding them.
 */
export function comparisonVariants(candidate: ComparisonCandidate, backend: ThreeBackend) {
  const a = stressPresets.Baseline;
  const b = stressPresets[candidate];
  const keys = ["cpuMs", "instances", "passes", "resolution"] as const;
  return {
    change: keys.find((key) => a[key] !== b[key]) ?? "cpuMs",
    variants: {
      A: { label: "Baseline", settings: { backend, ...a } },
      B: { label: candidate, settings: { backend, ...b } },
    },
  };
}
