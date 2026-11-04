import type { LiveGpu } from "../live/model.ts";
import { measured, unknown } from "../live/model.ts";

export interface GpuInvocation {
  id: string;
  label: string;
  kind: "render" | "compute";
  state: "timed" | "pending" | "rejected" | "omitted";
  milliseconds: number | null;
  /** Relative to this GPU frame's origin, never the CPU recording clock. */
  startMs: number | null;
  endMs: number | null;
  reason: string | null;
}

export interface GpuFrame {
  frameId: number;
  source: "webgl2" | "webgpu" | "host";
  clock: "gpu";
  epoch: number;
  resolutionMs: number | null;
  /** Only the host can assert that every render/compute invocation was registered. */
  inventory: "complete" | "unknown";
  invocations: GpuInvocation[];
  /** Invocations beyond the bounded record capacity; always incomplete. */
  omitted: number;
}

export const MAX_GPU_INVOCATIONS = 256;

export function validateGpuFrame(frame: GpuFrame) {
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const finite = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0);
  if (
    !integer(frame.frameId) ||
    !integer(frame.epoch) ||
    !integer(frame.omitted) ||
    !["webgl2", "webgpu", "host"].includes(frame.source) ||
    frame.clock !== "gpu" ||
    !["complete", "unknown"].includes(frame.inventory) ||
    !finite(frame.resolutionMs) ||
    frame.resolutionMs === 0 ||
    frame.invocations.length > MAX_GPU_INVOCATIONS
  )
    throw new Error("Invalid GPU frame evidence.");
  const ids = new Set<string>();
  for (const pass of frame.invocations) {
    if (
      typeof pass.id !== "string" ||
      !pass.id ||
      pass.id.length > 256 ||
      ids.has(pass.id) ||
      typeof pass.label !== "string" ||
      pass.label.length > 256 ||
      !["render", "compute"].includes(pass.kind) ||
      !["timed", "pending", "rejected", "omitted"].includes(pass.state) ||
      !finite(pass.milliseconds) ||
      !finite(pass.startMs) ||
      !finite(pass.endMs) ||
      (pass.reason !== null && (typeof pass.reason !== "string" || pass.reason.length > 1024)) ||
      (pass.state === "timed") !== (pass.milliseconds !== null) ||
      (pass.startMs === null) !== (pass.endMs === null) ||
      (pass.state !== "timed" && pass.startMs !== null) ||
      (pass.startMs !== null &&
        pass.endMs !== null &&
        (pass.endMs < pass.startMs ||
          Math.abs(pass.endMs - pass.startMs - (pass.milliseconds ?? 0)) > 1e-6)) ||
      ((pass.state === "rejected" || pass.state === "omitted") && !pass.reason)
    )
      throw new Error("Invalid GPU invocation evidence.");
    ids.add(pass.id);
  }
  return frame;
}

export function gpuFrameCoverage(frame: GpuFrame) {
  const timed = frame.invocations.filter((pass) => pass.state === "timed").length;
  const pending = frame.invocations.filter((pass) => pass.state === "pending").length;
  const rejected = frame.invocations.filter((pass) => pass.state === "rejected").length;
  const omitted =
    frame.omitted + frame.invocations.filter((pass) => pass.state === "omitted").length;
  const expected = frame.inventory === "complete" ? frame.invocations.length + frame.omitted : null;
  const completeness =
    frame.inventory === "unknown"
      ? "unknown"
      : pending || rejected || omitted
        ? "partial"
        : "complete";
  return { timed, pending, rejected, omitted, expected, completeness } as const;
}

export function gpuCoverage(frameIds: readonly number[], records: readonly GpuFrame[]) {
  const byId = new Map(records.map((record) => [record.frameId, record]));
  const result = {
    complete: 0,
    partial: 0,
    unknown: 0,
    missing: 0,
    pending: 0,
    total: frameIds.length,
  };
  for (const id of frameIds) {
    const record = byId.get(id);
    if (!record) {
      result.missing++;
      continue;
    }
    const coverage = gpuFrameCoverage(record);
    result[coverage.completeness]++;
    result.pending += coverage.pending;
  }
  return result;
}
export type GpuCoverage = ReturnType<typeof gpuCoverage>;

export function gpuFrameToLive(frame: GpuFrame, currentFrame: number): LiveGpu {
  validateGpuFrame(frame);
  const coverage = gpuFrameCoverage(frame);
  const timed = frame.invocations.filter((pass) => pass.state === "timed");
  const total = timed.reduce((sum, pass) => sum + (pass.milliseconds ?? 0), 0);
  const intervals = timed.filter((pass) => pass.startMs !== null && pass.endMs !== null);
  return {
    status: coverage.pending ? "pending" : "ready",
    completeness: coverage.completeness,
    expected: coverage.expected,
    timed: coverage.timed,
    sampleFrame: frame.frameId,
    ageFrames: Math.max(0, currentFrame - frame.frameId),
    dropped: 0,
    busy: unknown("Pass timestamps do not establish GPU device busy time"),
    timedWork:
      coverage.completeness === "complete" || timed.length
        ? measured(total)
        : unknown("No valid GPU timings"),
    span:
      coverage.completeness === "complete" && intervals.length === timed.length
        ? measured(
            intervals.length
              ? Math.max(...intervals.map((p) => p.endMs ?? 0)) -
                  Math.min(...intervals.map((p) => p.startMs ?? 0))
              : 0,
          )
        : unknown("A complete set of GPU start/end timestamps is unavailable"),
    evidence: frame,
    passes: frame.invocations.map((pass) => ({
      id: pass.id,
      label: pass.label,
      kind: pass.kind,
      duration:
        pass.state === "timed" && pass.milliseconds !== null
          ? measured(pass.milliseconds)
          : {
              status:
                pass.state === "omitted"
                  ? "not-recorded"
                  : pass.state === "timed"
                    ? "unknown"
                    : pass.state,
              reason: pass.reason ?? "GPU readback pending",
            },
    })),
  };
}
