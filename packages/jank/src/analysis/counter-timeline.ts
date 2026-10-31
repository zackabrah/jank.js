import type { CounterSample } from "../core/frames.ts";
import type { Recording } from "../recordings/recording.ts";
import type { TimelineWindow } from "./timeline.ts";

export interface CounterIdentity {
  readonly channelId: string;
  readonly name: string;
  readonly label: string;
}
interface CounterPoint {
  readonly elapsedMs: number;
  readonly value: number | null;
  readonly note: string;
}
interface CounterChange {
  readonly value: number | null;
  readonly previousElapsedMs: number | null;
  readonly intervalMs: number | null;
  readonly skippedSamples: number;
  readonly note: string;
}
export interface CounterObservation extends CounterPoint {
  readonly ageMs: number | null;
  readonly change: CounterChange;
}
export interface CounterLane {
  readonly identity: CounterIdentity;
  readonly points: readonly CounterPoint[];
  readonly endsAtMs: number;
}
export interface CounterTimeline {
  readonly window: TimelineWindow;
  readonly lanes: readonly CounterLane[];
}

/** Field names have no unit metadata. Matching identities retain raw values; no unit inference. */
export function counterCatalog(a: Recording | null, b: Recording | null): CounterIdentity[] {
  const channels = [...(a?.channels ?? []), ...(b?.channels ?? [])];
  const left = numericFields(a);
  const right = numericFields(b);
  const seen = new Set<string>();
  const identities: CounterIdentity[] = [];
  for (const channel of channels) {
    if (seen.has(channel.id)) {
      continue;
    }
    seen.add(channel.id);
    const names = new Set([...(left.get(channel.id) ?? []), ...(right.get(channel.id) ?? [])]);
    for (const name of names) {
      identities.push({ channelId: channel.id, name, label: `${channel.label} · ${name}` });
    }
  }
  return identities;
}
function numericFields(recording: Recording | null): Map<string, Set<string>> {
  const providers = new Map<string, Set<string>>();
  for (const sample of recording?.counters ?? []) {
    if (sample.status !== "ready") {
      continue;
    }
    const names = providers.get(sample.channelId) ?? new Set<string>();
    for (const [name, value] of Object.entries(sample.values)) {
      if (typeof value === "number") {
        names.add(name);
      }
    }
    providers.set(sample.channelId, names);
  }
  return providers;
}

export function buildCounterTimeline(
  recording: Recording | null,
  catalog: readonly CounterIdentity[],
  window: TimelineWindow,
): CounterTimeline {
  const origin = recording?.frames[0]?.startedAtMs ?? 0;
  const endsAtMs = (recording?.frames.at(-1)?.endedAtMs ?? origin) - origin;
  const providers = new Map<string, CounterSample[]>();
  for (const sample of recording?.counters ?? []) {
    const samples = providers.get(sample.channelId) ?? [];
    samples.push(sample);
    providers.set(sample.channelId, samples);
  }
  for (const samples of providers.values()) {
    samples.sort((a, b) => a.atMs - b.atMs);
  }
  return {
    window,
    lanes: catalog.map((identity) => ({
      identity,
      endsAtMs,
      points: counterPoints(providers.get(identity.channelId) ?? [], identity.name, origin),
    })),
  };
}
function counterPoints(
  samples: readonly CounterSample[],
  name: string,
  origin: number,
): CounterPoint[] {
  const points: CounterPoint[] = [];
  for (const sample of samples) {
    const elapsedMs = sample.atMs - origin;
    if (points.at(-1)?.elapsedMs === elapsedMs) {
      points[points.length - 1] = {
        elapsedMs,
        value: null,
        note: "Ambiguous provider samples at the same timestamp",
      };
      continue;
    }
    if (sample.status === "error") {
      points.push({ elapsedMs, value: null, note: `Provider error: ${sample.message}` });
      continue;
    }
    const value = Object.hasOwn(sample.values, name) ? sample.values[name] : undefined;
    if (typeof value === "number") {
      points.push({ elapsedMs, value, note: "Observed sample" });
    } else {
      points.push({ elapsedMs, value: null, note: missingValue(value) });
    }
  }
  return points;
}
function missingValue(value: unknown): string {
  if (value === undefined) {
    return "Field missing from provider sample";
  }
  if (value === null) {
    return "Value unavailable";
  }
  return "Non-numeric value";
}
export function counterAtTime(lane: CounterLane, elapsedMs: number): CounterObservation {
  const unknown = {
    elapsedMs,
    value: null,
    ageMs: null,
    note: "No earlier sample",
    change: unknownChange("Current sample unavailable"),
  };
  if (elapsedMs < 0 || elapsedMs > lane.endsAtMs) {
    return { ...unknown, note: "Outside recorded time range" };
  }
  let low = 0;
  let high = lane.points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lane.points[middle]?.elapsedMs ?? Infinity) <= elapsedMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const point = lane.points[low - 1];
  return point
    ? { ...point, ageMs: elapsedMs - point.elapsedMs, change: counterChange(lane, low - 1) }
    : unknown;
}
export function counterScale(
  a: CounterLane,
  b: CounterLane | undefined,
  window: TimelineWindow,
): { minimum: number; maximum: number } {
  let minimum = 0;
  let maximum = 0;
  for (const lane of [a, b]) {
    for (const point of lane?.points ?? []) {
      if (
        point.value === null ||
        point.elapsedMs < window.fromMs ||
        point.elapsedMs >= window.toMs
      ) {
        continue;
      }
      minimum = Math.min(minimum, point.value);
      maximum = Math.max(maximum, point.value);
    }
  }
  return { minimum, maximum: minimum === maximum ? 1 : maximum };
}

function unknownChange(note: string): CounterChange {
  return { value: null, previousElapsedMs: null, intervalMs: null, skippedSamples: 0, note };
}
function counterChange(lane: CounterLane, index: number): CounterChange {
  const point = lane.points[index];
  if (!point || point.value === null) {
    return unknownChange("Current sample unavailable");
  }
  let skippedSamples = 0;
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previous = lane.points[previousIndex];
    if (!previous || previous.value === null) {
      skippedSamples += 1;
      continue;
    }
    const delta = point.value - previous.value;
    const note = skippedSamples
      ? `${skippedSamples} invalid poll(s) skipped`
      : "Previous valid sample";
    return {
      value: Number.isFinite(delta) ? delta : null,
      previousElapsedMs: previous.elapsedMs,
      intervalMs: point.elapsedMs - previous.elapsedMs,
      skippedSamples,
      note: Number.isFinite(delta) ? note : "Change exceeds numeric range",
    };
  }
  return { ...unknownChange("No previous valid sample"), skippedSamples };
}
