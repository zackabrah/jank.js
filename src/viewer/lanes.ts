import type { GpuFrame } from "../gpu/model.ts";
import { readEvents } from "../live/events.ts";
import { unionDuration } from "../recording/timing.ts";
import type { PerformanceRecording } from "../recording/types.ts";

export interface LaneValue {
  value: number | null;
  status:
    | "measured"
    | "partial"
    | "missing"
    | "unknown"
    | "pending"
    | "rejected"
    | "omitted"
    | "absent";
  reason: string;
}

export interface TimingLane {
  id: string;
  label: string;
  description: string;
  group: "cpu" | "gpu" | "context";
  values: Map<number, LaneValue>;
}

export function recordingLanes(recording: PerformanceRecording) {
  const cpu = new Map<string, TimingLane>();
  const gpu = new Map<string, TimingLane>();
  const unattributed: TimingLane = {
    id: "unattributed",
    label: "Unattributed",
    group: "context",
    description:
      "Frame interval outside recorded CPU scopes: waiting and untracked work, not CPU busy time.",
    values: new Map(),
  };
  const profiler: TimingLane = {
    id: "profiler",
    label: "Profiler",
    group: "context",
    description:
      "Recorded synchronous collection + refresh cost; may overlap scopes. Excludes deferred layout, paint and GPU work.",
    values: new Map(),
  };
  let cpuPeak = recording.budget.frameMs;
  let gpuPeak = 1;
  for (const [index, frame] of recording.frames.entries()) {
    const complete = frame.coverage === "complete" && frame.droppedScopes === 0;
    const scopes = new Map<string, typeof frame.scopes>();
    for (const scope of frame.scopes) {
      const id = JSON.stringify([scope.system, scope.label]);
      if (!cpu.has(id))
        cpu.set(id, {
          id,
          label: scope.label || scope.system,
          group: "cpu",
          description: `${scope.system} · ${scope.label}. Union of matching scope intervals; different lanes may overlap.`,
          values: new Map(),
        });
      const group = scopes.get(id) ?? [];
      group.push(scope);
      scopes.set(id, group);
    }
    for (const [id, intervals] of scopes) {
      const value = unionDuration(intervals);
      cpuPeak = Math.max(cpuPeak, value);
      cpu.get(id)?.values.set(index, {
        value,
        status: complete ? "measured" : "partial",
        reason: complete
          ? "Recorded scope intervals"
          : "Retained scopes only; CPU coverage is incomplete",
      });
    }
    const value = Math.max(0, frame.interval - unionDuration(frame.scopes));
    unattributed.values.set(index, {
      value: complete ? value : null,
      status: complete ? "measured" : "unknown",
      reason: complete ? unattributed.description : "Complete CPU scope coverage is required",
    });
    const cost = frame.overhead.collectionMs + frame.overhead.refreshMs;
    const legacy = recording.metadata.importedFromVersion === 1;
    const knownCost = !legacy && Number.isFinite(cost);
    profiler.values.set(index, {
      value: knownCost ? cost : null,
      status: knownCost ? "measured" : "unknown",
      reason: legacy
        ? "Legacy recordings did not retain profiler cost"
        : knownCost
          ? profiler.description
          : "Recorded profiler cost exceeds the numeric range",
    });
    cpuPeak = Math.max(cpuPeak, complete ? value : 0, knownCost ? cost : 0);
  }
  const gpuFrames = new Map<number, GpuFrame>();
  const indices = new Map(recording.frames.map((frame, index) => [frame.id, index]));
  for (const record of recording.gpuTiming?.frames ?? []) {
    const index = indices.get(record.frameId);
    if (index === undefined) continue;
    gpuFrames.set(index, record);
    const occurrences = new Map<string, number>();
    for (const pass of record.invocations) {
      const key = JSON.stringify([pass.kind, pass.label]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      const id = JSON.stringify([pass.kind, pass.label, occurrence]);
      if (!gpu.has(id))
        gpu.set(id, {
          id,
          label: `${pass.label || "Untitled pass"} ×${occurrence}`,
          group: "gpu",
          description: `${pass.kind} · occurrence ${occurrence} of this label within each frame, not a persistent invocation ID. GPU clock.`,
          values: new Map(),
        });
      gpu.get(id)?.values.set(index, {
        value: pass.milliseconds,
        status: pass.state === "timed" ? "measured" : pass.state,
        reason:
          pass.reason ??
          (pass.state === "pending" ? "GPU readback pending" : "Recorded GPU duration"),
      });
      gpuPeak = Math.max(gpuPeak, pass.milliseconds ?? 0);
    }
  }
  return {
    cpu: [...cpu.values()],
    gpu: [...gpu.values()],
    context: [unattributed, profiler],
    gpuFrames,
    cpuCeiling: Math.min(Number.MAX_VALUE, Math.ceil(cpuPeak / 10) * 10),
    gpuCeiling: Math.ceil(gpuPeak),
    events: readEvents(recording.events, recording.frames) ?? [],
  };
}

export function laneValue(
  lane: TimingLane,
  index: number,
  recording: PerformanceRecording,
  gpuFrames: Map<number, GpuFrame>,
): LaneValue {
  const value = lane.values.get(index);
  if (value) return value;
  if (lane.group === "gpu") {
    const record = gpuFrames.get(index);
    if (!record)
      return { value: null, status: "missing", reason: "No GPU record linked to this frame" };
    if (record.inventory === "unknown" || record.omitted > 0)
      return {
        value: null,
        status: "unknown",
        reason: "Invocation inventory is unknown or has omitted records",
      };
    return {
      value: null,
      status: "absent",
      reason: "This invocation was not recorded in the complete inventory",
    };
  }
  const frame = recording.frames[index];
  return frame?.coverage === "complete" && frame.droppedScopes === 0
    ? {
        value: 0,
        status: "measured",
        reason: "No matching CPU scope observed in this complete frame",
      }
    : { value: null, status: "unknown", reason: "CPU scopes are unavailable or incomplete" };
}

export function laneGeometry(values: LaneValue[], ceiling: number) {
  const pitch = 300 / Math.max(1, values.length);
  let bars = "",
    missing = "",
    rejected = "",
    pending = "",
    unknown = "",
    zero = "";
  let min = Infinity,
    max = -Infinity;
  for (const [index, cell] of values.entries()) {
    const x = (index + 0.5) * pitch;
    if (cell.value !== null) {
      min = Math.min(min, cell.value);
      max = Math.max(max, cell.value);
      const height = (cell.value / ceiling) * 40;
      if (height === 0) zero += `M${x - pitch * 0.3},39h${pitch * 0.6}`;
      else bars += `M${x - pitch * 0.35},40v-${height}h${pitch * 0.7}v${height}Z`;
    } else if (cell.status === "missing") missing += `M${x - pitch * 0.3},40l${pitch * 0.6},-5`;
    else if (cell.status === "rejected")
      rejected += `M${x - pitch * 0.35},34l${pitch * 0.7},6m0,-6l-${pitch * 0.7},6`;
    else if (cell.status === "pending") pending += `M${x - pitch * 0.3},36h${pitch * 0.6}`;
    else if (cell.status !== "absent") unknown += `M${x},35v5`;
  }
  return {
    bars,
    missing,
    rejected,
    pending,
    unknown,
    zero,
    quiet: max >= 0 && max <= ceiling * 0.1 && max - min <= ceiling * 0.02,
  };
}
