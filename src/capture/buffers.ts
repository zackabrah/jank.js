import { type GpuCoverage, MAX_GPU_INVOCATIONS } from "../gpu/model.ts";
import type { DiagnosticsSnapshot } from "../live/model.ts";
import type { CaptureSource } from "./controller.ts";

export interface GpuPool {
  free: number;
  total?: number;
  unit: "passes" | "samples";
}

function count(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Buffer counts must be non-negative integers.");
  return value;
}

function coverage(source: CaptureSource, ids: readonly number[]): GpuCoverage | null {
  if (!source.gpuCoverage) return null;
  if (ids.length > 6000 || new Set(ids).size !== ids.length)
    throw new Error("Invalid buffer frame IDs.");
  for (const id of ids) count(id);
  const result = { ...source.gpuCoverage(ids) };
  const total = [result.complete, result.partial, result.unknown, result.missing].reduce(
    (sum, value) => sum + count(value),
    0,
  );
  count(result.pending);
  if (
    result.total !== ids.length ||
    total !== ids.length ||
    result.pending > (result.partial + result.unknown) * MAX_GPU_INVOCATIONS
  )
    throw new Error("GPU coverage does not match the requested frame window.");
  return result;
}

/** Display-rate reads only; unavailable metadata must never prevent capture or saving. */
export function readBuffers(
  source: CaptureSource,
  snapshot: DiagnosticsSnapshot,
  recordingCount: number | null,
  heldIds?: readonly number[],
) {
  const recent = snapshot.frames.length;
  try {
    const capacity = source.recentFrameCapacity ?? null;
    if (capacity !== null && (count(capacity) < recent || capacity === 0))
      throw new Error("Recent buffer exceeds its declared capacity.");
    const pool = source.gpuPool?.() ?? null;
    if (pool) {
      count(pool.free);
      if (pool.unit !== "passes" && pool.unit !== "samples")
        throw new Error("Unknown GPU pool unit.");
      if (pool.total !== undefined && count(pool.total) < pool.free)
        throw new Error("GPU pool free count exceeds its total.");
    }
    const ids =
      recordingCount === null || !source.gpuCoverage
        ? null
        : (heldIds ?? (recordingCount === 0 ? [] : source.recordingFrameIds?.()) ?? null);
    if (ids && ids.length !== recordingCount)
      throw new Error("Recording frame IDs do not match the recorded-frame count.");
    return {
      recent,
      capacity,
      recentGpu: coverage(
        source,
        snapshot.frames.map((frame) => frame.id),
      ),
      recordingGpu: ids ? coverage(source, ids) : null,
      pool: pool ? { ...pool } : null,
      error: "",
    };
  } catch (error) {
    return {
      recent,
      capacity: null,
      recentGpu: null,
      recordingGpu: null,
      pool: null,
      error: error instanceof Error ? error.message : "Host buffer details are unavailable.",
    };
  }
}
