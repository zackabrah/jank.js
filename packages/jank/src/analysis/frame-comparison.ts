import type { FrameSample } from "../core/frames.ts";
import type { GpuSample } from "../core/gpu.ts";
import type { Recording } from "../recordings/recording.ts";
import { intervalUnion } from "./statistics.ts";

export interface WorkIdentity {
  readonly kind: "cpu" | "gpu";
  readonly key: string;
  readonly label: string;
  readonly displayLabel: string;
}
export interface WorkMeasurement {
  readonly durationMs: number | null;
  readonly comparable: boolean;
  readonly note: string;
}
export interface ComparedWork extends WorkIdentity {
  readonly a: WorkMeasurement;
  readonly b: WorkMeasurement;
  readonly differenceMs: number | null;
}
interface FrameEvidence {
  readonly recording: Recording | null;
  readonly frame: FrameSample | null;
}

/** Half-open intervals keep gaps and the unsealed tail unknown, across independent clock origins. */
export function frameAtElapsed(recording: Recording | null, elapsedMs: number): FrameSample | null {
  const origin = recording?.frames[0]?.startedAtMs;
  if (origin === undefined || !recording) {
    return null;
  }
  const atMs = origin + elapsedMs;
  return (
    recording.frames.find((frame) => frame.startedAtMs <= atMs && atMs < frame.endedAtMs) ?? null
  );
}

interface PassMeasurement extends WorkIdentity {
  readonly measurement: WorkMeasurement;
}
const unknown = (note: string): WorkMeasurement => ({ durationMs: null, comparable: false, note });

function gpuPasses(sample: GpuSample): PassMeasurement[] {
  if (sample.measurement !== "intervals") {
    return sample.passes.map((pass) => ({
      kind: "gpu",
      key: JSON.stringify([sample.measurement, pass.label]),
      label: `${pass.label} · ${sample.measurement}`,
      displayLabel: pass.label,
      measurement: {
        durationMs: pass.durationMs,
        comparable: pass.durationMs !== null,
        note: "Reported pass duration",
      },
    }));
  }
  return [...sample.passes, ...sample.rejectedPasses].map((pass) => ({
    kind: "gpu",
    key: JSON.stringify(["intervals", pass.id, pass.type, pass.invocation]),
    label: `${pass.label} · ${pass.id} / ${pass.type} #${pass.invocation}`,
    displayLabel: `${pass.label} #${pass.invocation}`,
    measurement:
      "reason" in pass
        ? unknown(`Rejected: ${pass.reason}`)
        : {
            durationMs: (pass.endNs - pass.startNs) / 1e6,
            comparable: true,
            note: "Observed interval",
          },
  }));
}

/** A's configured CPU order and first-seen GPU order, then B-only identities; never timing rank. */
export function workCatalog(a: Recording | null, b: Recording | null): WorkIdentity[] {
  const entries = new Map<string, WorkIdentity>();
  for (const recording of [a, b]) {
    if (!recording) {
      continue;
    }
    const identities: WorkIdentity[] = [
      ...recording.channels.map((channel) => ({
        kind: "cpu" as const,
        key: channel.id,
        label: `${channel.label} · ${channel.id}`,
        displayLabel: channel.label,
      })),
      ...recording.gpu.flatMap(gpuPasses),
    ];
    for (const entry of identities) {
      const key = JSON.stringify([entry.kind, entry.key]);
      const previous = entries.get(key);
      if (!previous) {
        entries.set(key, {
          kind: entry.kind,
          key: entry.key,
          label: entry.label,
          displayLabel: entry.displayLabel,
        });
      }
    }
  }
  return [...entries.values()].sort((a, b) => Number(a.kind === "gpu") - Number(b.kind === "gpu"));
}

function cpuMeasurement(frame: FrameSample, channelId: string): WorkMeasurement {
  const scopes = frame.scopes.filter((scope) => scope.channelId === channelId);
  if (scopes.length === 0) {
    return unknown("Not observed in this frame");
  }
  return {
    durationMs: intervalUnion(scopes),
    comparable: frame.coverage.status === "complete",
    note: frame.coverage.status === "complete" ? "Scope union" : "Partial scope coverage",
  };
}

/** Shared per-frame semantics for comparison tables and timeline lanes. */
export function measureFrameWork(
  frame: FrameSample | null,
  samples: readonly GpuSample[],
  catalog: readonly WorkIdentity[],
): WorkMeasurement[] {
  if (!frame) {
    return catalog.map(() => unknown("No frame at this elapsed time"));
  }
  const sample = samples.length === 1 ? samples[0] : undefined;
  const passes = sample ? gpuPasses(sample) : [];
  return catalog.map((identity) => {
    if (identity.kind === "cpu") {
      return cpuMeasurement(frame, identity.key);
    }
    if (!sample) {
      return unknown(samples.length > 1 ? "Multiple GPU observations" : "No GPU observation");
    }
    const matches = passes.filter((pass) => pass.key === identity.key);
    if (matches.length > 1) {
      return unknown("Ambiguous pass identity");
    }
    return matches[0]?.measurement ?? unknown("Pass not observed / measurement differs");
  });
}

export function compareFrameWork(
  catalog: readonly WorkIdentity[],
  a: FrameEvidence,
  b: FrameEvidence,
): ComparedWork[] {
  const left = measureFrameWork(
    a.frame,
    a.recording?.gpu.filter((sample) => sample.frameId === a.frame?.id) ?? [],
    catalog,
  );
  const right = measureFrameWork(
    b.frame,
    b.recording?.gpu.filter((sample) => sample.frameId === b.frame?.id) ?? [],
    catalog,
  );
  return catalog.map((identity, index) => {
    const a = left[index] ?? unknown("Not observed");
    const b = right[index] ?? unknown("Not observed");
    const differenceMs =
      a.comparable && b.comparable && a.durationMs !== null && b.durationMs !== null
        ? b.durationMs - a.durationMs
        : null;
    return { ...identity, a, b, differenceMs };
  });
}
