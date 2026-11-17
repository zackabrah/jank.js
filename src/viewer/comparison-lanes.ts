import type { ComparisonBundle } from "../compare/model.ts";
import type { FrameInterval } from "./comparison-frames.ts";
import { type Counter, readCounter, recordingCounters } from "./inspector-model.ts";
import { type LaneValue, laneValue, recordingLanes, type TimingLane } from "./lanes.ts";

export type ComparisonLane =
  | TimingLane
  | {
      group: "counter";
      id: string;
      label: string;
      description: string;
      counter: Counter;
    };

export function comparisonLanes(bundle: ComparisonBundle, pair: number) {
  const sources = (["A", "B"] as const).map((key) => {
    const recording = bundle.trials.find(
      (trial) => trial.pair === pair && trial.variant === key,
    )?.recording;
    return {
      key,
      recording,
      timing: recording ? recordingLanes(recording) : null,
      counters: recording ? recordingCounters(recording) : null,
    };
  });
  const catalog = new Map<string, ComparisonLane>();
  for (const source of sources) {
    for (const lane of [
      ...(source.timing?.cpu ?? []),
      ...(source.timing?.gpu ?? []),
      ...(source.timing?.context ?? []),
    ])
      if (!catalog.has(`${lane.group}:${lane.id}`)) catalog.set(`${lane.group}:${lane.id}`, lane);
    for (const counter of source.counters?.counters ?? [])
      if (counter.numeric && !catalog.has(`counter:${counter.id}`))
        catalog.set(`counter:${counter.id}`, {
          group: "counter",
          id: counter.id,
          label: counter.key,
          description: `${counter.systemLabel} · ${counter.key}`,
          counter,
        });
  }
  return {
    sources,
    lanes: [...catalog.values()],
    cpuCeiling: Math.max(1, ...sources.map((source) => source.timing?.cpuCeiling ?? 0)),
    gpuCeiling: Math.max(1, ...sources.map((source) => source.timing?.gpuCeiling ?? 0)),
  };
}

export function comparisonLaneValues(
  source: ReturnType<typeof comparisonLanes>["sources"][number],
  lane: ComparisonLane,
  points: FrameInterval[],
): (LaneValue & { age?: number | null })[] {
  const { recording, timing, counters } = source;
  if (!recording || !timing || !counters) return [];
  if (lane.group === "counter")
    return points.map((point) => {
      const frame = recording.frames[point.index];
      const sample = readCounter(
        counters,
        lane.counter,
        frame ? frame.at - frame.interval : -Infinity,
      );
      return {
        value: typeof sample.value === "number" ? sample.value : null,
        status: typeof sample.value === "number" ? "measured" : "missing",
        age: sample.age,
        reason:
          typeof sample.value === "string" || typeof sample.value === "boolean"
            ? "Latest counter sample is not numeric"
            : sample.reason,
      };
    });
  const own = timing[lane.group].find((item) => item.id === lane.id) ?? {
    ...lane,
    values: new Map(),
  };
  return points.map((point) => laneValue(own, point.index, recording, timing.gpuFrames));
}

/** Separate scales for CPU/GPU and each counter; A and B always share a lane's scale. */
export function comparisonLaneGeometry(
  points: { start: number; end: number }[],
  values: LaneValue[],
  duration: number,
  low: number,
  high: number,
) {
  const magnitude = Math.max(1, Math.abs(low), Math.abs(high));
  const span = high / magnitude - low / magnitude;
  const y = (value: number) =>
    span ? 100 - ((value / magnitude - low / magnitude) / span) * 100 : 50;
  let path = "",
    missing = "",
    end = 0,
    connected = false;
  const gap = (start: number, end: number) => {
    if (end <= start) return;
    const left = (start / duration) * 100,
      right = (end / duration) * 100;
    missing += `M${left},90H${right}V100H${left}Z`;
  };
  for (const [index, point] of points.entries()) {
    if (point.start > end + 1e-6) {
      gap(end, point.start);
      connected = false;
    }
    const cell = values[index];
    if (cell?.status === "measured" && cell.value !== null) {
      const left = (point.start / duration) * 100,
        right = (point.end / duration) * 100,
        top = y(cell.value);
      path += connected ? `V${top}H${right}` : `M${left},${top}H${right}`;
      connected = true;
    } else {
      gap(point.start, point.end);
      connected = false;
    }
    end = point.end;
  }
  gap(end, duration);
  return { path, missing, y };
}
