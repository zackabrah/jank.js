import type { FrameInterval } from "./comparison-frames.ts";
import { comparisonLaneGeometry } from "./comparison-lanes.ts";
import type { LaneValue } from "./lanes.ts";

interface DifferenceSeries {
  points: FrameInterval[];
  values: LaneValue[];
}

/** B − A only between two measured values; null when either lacks one. May overflow. */
export function measuredDifference(a: LaneValue | undefined, b: LaneValue | undefined) {
  return a?.status === "measured" &&
    b?.status === "measured" &&
    a.value !== null &&
    b.value !== null
    ? b.value - a.value
    : null;
}

/** Split at either variant's frame boundaries; never match frame IDs or interpolate gaps. */
export function comparisonDifference(a: DifferenceSeries, b: DifferenceSeries, duration: number) {
  const points: { start: number; end: number }[] = [];
  const values: LaneValue[] = [];
  let ai = 0,
    bi = 0,
    extent = 1;
  while (ai < a.points.length && bi < b.points.length) {
    const af = a.points[ai],
      bf = b.points[bi];
    if (!af || !bf) break;
    const start = Math.max(af.start, bf.start),
      end = Math.min(af.end, bf.end);
    if (end > start) {
      const av = a.values[ai],
        bv = b.values[bi];
      const value = measuredDifference(av, bv);
      const finite = value !== null && Number.isFinite(value);
      points.push({ start, end });
      values.push({
        value: finite ? value : null,
        status: finite ? "measured" : "missing",
        reason: finite
          ? "B minus A at the same elapsed time; independent recorded frame intervals."
          : value !== null
            ? "Difference exceeds the numeric range."
            : `A: ${av?.reason ?? "No measurement"}. B: ${bv?.reason ?? "No measurement"}.`,
      });
      if (finite) extent = Math.max(extent, Math.abs(value));
    }
    if (af.end <= bf.end) ai++;
    if (bf.end <= af.end) bi++;
  }
  return {
    points,
    values,
    extent,
    known: values.some((cell) => cell.value !== null),
    geometry: comparisonLaneGeometry(points, values, duration, -extent, extent),
  };
}
