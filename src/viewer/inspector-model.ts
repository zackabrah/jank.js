import type {
  DiagnosticFrame,
  DiagnosticSystem,
  PerformanceRecording,
} from "../recording/types.ts";
import type { recordingLanes } from "./lanes.ts";

export interface Counter {
  id: string;
  system: string;
  systemLabel: string;
  key: string;
  numeric: boolean;
}

export function recordingCounters(recording: PerformanceRecording) {
  const catalog = new Map<string, Counter>();
  const collect = (systems: DiagnosticSystem[]) => {
    const indexed = new Map<string, DiagnosticSystem>();
    for (const system of systems) {
      indexed.set(system.id, system);
      for (const [key, value] of Object.entries(system.values)) {
        const id = JSON.stringify([system.id, key]);
        const previous = catalog.get(id);
        catalog.set(id, {
          id,
          system: system.id,
          systemLabel: system.label || system.id,
          key,
          numeric: previous?.numeric === true || typeof value === "number",
        });
      }
    }
    return indexed;
  };
  const samples = recording.samples.map((sample) => ({
    at: sample.at,
    systems: collect(sample.systems),
  }));
  collect(recording.systems);
  return { counters: [...catalog.values()], samples };
}

export type CounterModel = ReturnType<typeof recordingCounters>;

export function sampleAt(samples: readonly { at: number }[], at: number) {
  let low = 0,
    high = samples.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((samples[mid]?.at ?? Infinity) <= at) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function readCounter(model: CounterModel, counter: Counter, at: number) {
  const index = sampleAt(model.samples, at);
  const sample = model.samples[index];
  const value = sample?.systems.get(counter.system)?.values[counter.key];
  const previous = model.samples[index - 1]?.systems.get(counter.system)?.values[counter.key];
  const difference =
    typeof value === "number" && typeof previous === "number" ? value - previous : null;
  return {
    value,
    at: sample?.at ?? null,
    age: sample && value !== undefined ? at - sample.at : null,
    delta: difference !== null && Number.isFinite(difference) ? difference : null,
    changed:
      value !== undefined && value !== null && previous !== undefined && previous !== null
        ? value !== previous
        : null,
    reason: !sample
      ? "No sample at or before frame start"
      : value === undefined
        ? "Counter absent from the latest sample at frame start"
        : value === null
          ? "Host reported unavailable"
          : "Latest sample at or before frame start",
  };
}

export function scopeMedians(
  recording: PerformanceRecording,
  lanes: ReturnType<typeof recordingLanes>,
) {
  const count = recording.frames.filter(
    (frame) => frame.coverage === "complete" && !frame.droppedScopes,
  ).length;
  const medians = new Map<string, number>();
  if (!count) return medians;
  for (const lane of lanes.cpu) {
    const values = [...lane.values.values()]
      .flatMap((cell) => (cell.status === "measured" && cell.value !== null ? [cell.value] : []))
      .sort((a, b) => a - b);
    const zeros = count - values.length;
    const at = (index: number) => (index < zeros ? 0 : (values[index - zeros] ?? 0));
    const low = at(Math.floor((count - 1) / 2));
    medians.set(lane.id, low + (at(Math.ceil((count - 1) / 2)) - low) / 2);
  }
  return medians;
}

export function largestScopeChange(
  lanes: ReturnType<typeof recordingLanes>,
  medians: Map<string, number>,
  index: number,
) {
  let largest: { label: string; delta: number; median: number } | null = null;
  for (const lane of lanes.cpu) {
    const value = lane.values.get(index);
    const median = medians.get(lane.id);
    if (value?.status !== "measured" || value.value === null || median === undefined) continue;
    const delta = value.value - median;
    if (delta > (largest?.delta ?? 0)) largest = { label: lane.label, delta, median };
  }
  return largest;
}

export function frameEvidence(recording: PerformanceRecording, frame: DiagnosticFrame) {
  const frameStart = frame.at - frame.interval;
  const index = sampleAt(recording.samples, frameStart);
  return {
    units: recording.units,
    budget: recording.budget,
    frame,
    gpuTiming: recording.gpuTiming?.frames.find((record) => record.frameId === frame.id) ?? null,
    legacyGpu:
      recording.gpu?.samples.findLast((record) => record.diagnosticFrame === frame.id) ?? null,
    counters: {
      frameStart,
      sample: recording.samples[index] ?? null,
      previousSample: recording.samples[index - 1] ?? null,
    },
    capture: recording.capture,
  };
}

export function counterGeometry(values: (number | null)[], low: number, high: number) {
  let line = "",
    missing = "",
    connected = false;
  const pitch = 300 / Math.max(1, values.length);
  // Scale before subtraction so opposite signed extremes still have finite coordinates.
  const magnitude = Math.max(1, Math.abs(low), Math.abs(high));
  const span = high / magnitude - low / magnitude;
  values.forEach((value, index) => {
    const x = index * pitch;
    if (value === null) {
      missing += `M${x},38l${pitch * 0.7},-4`;
      connected = false;
      return;
    }
    const y = span ? 36 - ((value / magnitude - low / magnitude) / span) * 32 : 20;
    line += `${connected ? "V" : `M${x},`}${y}H${x + pitch}`;
    connected = true;
  });
  return { line, missing };
}
