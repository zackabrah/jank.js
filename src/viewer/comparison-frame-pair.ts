import type { VariantKey } from "../compare/model.ts";
import { measuredDifference } from "./comparison-difference.ts";
import { comparisonFrameAt, type comparisonFrames } from "./comparison-frames.ts";
import {
  type ComparisonLane,
  type comparisonLanes,
  comparisonLaneValues,
} from "./comparison-lanes.ts";
import type { LaneValue } from "./lanes.ts";

type Cell = LaneValue & { age?: number | null };

/**
 * What each variant recorded at one elapsed time. These are separate runs: the frames overlap in
 * time, so they are never matched by ID or ordinal and their differences are only descriptive.
 */
export function comparisonFramePair(
  model: ReturnType<typeof comparisonLanes>,
  chart: ReturnType<typeof comparisonFrames>,
  at: number,
) {
  const side = (key: VariantKey) => {
    const frame = comparisonFrameAt(chart, key, at);
    const reason = chart.series.find((series) => series.key === key)?.reason;
    return {
      key,
      frame,
      reason: frame ? null : (reason ?? "No recorded frame at this time."),
      source: model.sources.find((source) => source.key === key),
    };
  };
  const a = side("A");
  const b = side("B");
  const read = (entry: typeof a, lane: ComparisonLane): Cell =>
    (entry.frame && entry.source && comparisonLaneValues(entry.source, lane, [entry.frame])[0]) || {
      value: null,
      status: "missing",
      reason: entry.reason ?? "No recorded frame at this time.",
    };
  const rows = model.lanes
    .flatMap((lane) => {
      const cellA = read(a, lane);
      const cellB = read(b, lane);
      // Neither frame has it. An unseen scope in a complete frame reads as a known zero.
      const unseen = (cell: Cell) =>
        cell.status === "absent" ||
        (lane.group === "cpu" && cell.status === "measured" && cell.value === 0);
      if (unseen(cellA) && unseen(cellB)) return [];
      const delta = measuredDifference(cellA, cellB);
      return [
        {
          lane,
          a: cellA,
          b: cellB,
          delta: delta !== null && Number.isFinite(delta) ? delta : null,
        },
      ];
    })
    // Largest difference first; values with no difference stay in catalog order after them.
    .sort(
      (first, second) =>
        (second.delta === null ? -1 : Math.abs(second.delta)) -
        (first.delta === null ? -1 : Math.abs(first.delta)),
    );
  return {
    a,
    b,
    delta: a.frame && b.frame ? b.frame.value - a.frame.value : null,
    rows,
  };
}
