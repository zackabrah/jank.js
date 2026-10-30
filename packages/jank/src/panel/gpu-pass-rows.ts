import { type GpuSample, type GpuState, gpuIntervalLimits } from "../core/gpu.ts";

export interface GpuPassRow {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly type: "compute" | "render" | null;
  readonly category: string | null;
  readonly occurrence: number;
  readonly durationMs: number | null;
  readonly status: "observed" | "not-observed" | "rejected" | "unavailable";
  readonly reason: string | null;
}

type Observation = Omit<GpuPassRow, "key" | "occurrence">;

/** A bounded, panel-owned row catalogue. Sample-wide invocation numbers are not stable identities. */
export function createGpuPassRows(order: readonly string[] = []) {
  const ranks = new Map(order.map((id, index) => [id, index]));
  if (
    order.length > gpuIntervalLimits.passes ||
    ranks.size !== order.length ||
    order.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new TypeError("GPU pass order must contain at most 256 unique, nonempty IDs");
  }
  const known = new Map<string, GpuPassRow>();
  let measurement: GpuSample["measurement"] | null = null;
  function clear(): void {
    known.clear();
    measurement = null;
  }
  return {
    clear,
    update(gpu: GpuState | null) {
      const sample = gpu?.status === "ready" ? gpu.sample : null;
      if (sample && measurement !== sample.measurement) {
        clear();
        measurement = sample.measurement;
      }
      for (const [key, row] of known) {
        known.set(key, {
          ...row,
          durationMs: null,
          status: sample ? "not-observed" : "unavailable",
          reason: null,
        });
      }
      const hiddenPasses = rememberObservations(known, sample);
      const rows = [...known.values()].sort(
        (left, right) => (ranks.get(left.id) ?? ranks.size) - (ranks.get(right.id) ?? ranks.size),
      );
      return { rows, hiddenPasses, measurement };
    },
  };
}

function observations(sample: GpuSample): Observation[] {
  if (sample.measurement !== "intervals") {
    return sample.passes.map((pass) => ({
      id: pass.label,
      label: pass.label,
      type: null,
      category: null,
      durationMs: pass.durationMs,
      status: "observed",
      reason: null,
    }));
  }
  return [...sample.passes, ...sample.rejectedPasses]
    .sort((left, right) => left.invocation - right.invocation)
    .map((pass) => {
      const rejected = "reason" in pass;
      return {
        id: pass.id,
        label: pass.label,
        type: pass.type,
        category: pass.category,
        durationMs: rejected ? null : (pass.endNs - pass.startNs) / 1e6,
        status: rejected ? "rejected" : "observed",
        reason: rejected ? pass.reason : null,
      };
    });
}

function rememberObservations(known: Map<string, GpuPassRow>, sample: GpuSample | null): number {
  let hiddenPasses = 0;
  const occurrences = new Map<string, number>();
  for (const observed of sample ? observations(sample) : []) {
    const group = JSON.stringify([observed.id, observed.type]);
    const occurrence = (occurrences.get(group) ?? 0) + 1;
    occurrences.set(group, occurrence);
    const key = JSON.stringify([observed.id, observed.type, occurrence]);
    const previous = known.get(key);
    if (!previous && known.size >= gpuIntervalLimits.passes) {
      hiddenPasses += 1;
      continue;
    }
    // Metadata stays fixed so changing sample availability cannot reflow labels.
    known.set(
      key,
      previous
        ? {
            ...previous,
            durationMs: observed.durationMs,
            status: observed.status,
            reason: observed.reason,
          }
        : { ...observed, key, occurrence },
    );
  }
  return hiddenPasses;
}
