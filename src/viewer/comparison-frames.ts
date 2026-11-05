import type { ComparisonBundle, VariantKey } from "../compare/model.ts";
import type { ComparisonRange } from "./comparison-range.ts";

export interface FrameInterval {
  index: number;
  id: number;
  start: number;
  end: number;
  value: number;
}

/** Align actual frame intervals to each trial's measurement start, never by ordinal or frame ID. */
export function comparisonFrames(bundle: ComparisonBundle, pair: number) {
  const series = (["A", "B"] as const).map((key) => {
    const trial = bundle.trials.find((trial) => trial.pair === pair && trial.variant === key);
    const duration = trial ? trial.measurementEndMs - trial.measurementStartMs : 0;
    const points: FrameInterval[] = [];
    let reason = trial ? null : `Trial ${pair}${key} was not completed.`;
    for (const [index, frame] of (trial?.recording.frames ?? []).entries()) {
      const end = frame.at - (trial?.measurementStartMs ?? 0);
      const start = end - frame.interval;
      if (
        start < -1e-6 ||
        end > duration + 1e-6 ||
        end <= start ||
        start < (points.at(-1)?.end ?? 0) - 1e-6
      ) {
        reason = `Trial ${pair}${key} has overlapping or out-of-window frame intervals.`;
        points.length = 0;
        break;
      }
      points.push({ index, id: frame.id, start: Math.max(0, start), end, value: frame.interval });
    }
    return { key, duration, points, reason };
  });
  const duration = Math.max(bundle.plan.measureMs, ...series.map((series) => series.duration));
  let low = bundle.budgetMs,
    high = bundle.budgetMs;
  for (const seriesValue of series)
    for (const point of seriesValue.points) {
      low = Math.min(low, point.value);
      high = Math.max(high, point.value);
    }
  const padding = Math.max(1, (high - low) * 0.15);
  const step = 10 ** Math.floor(Math.log10(Math.max(1, high))) / 10;
  const lower = Math.max(0, Math.floor((low - padding) / step) * step);
  const upper = Math.min(
    Number.MAX_VALUE,
    Math.ceil(Math.min(Number.MAX_VALUE, high + padding) / step) * step,
  );
  const y = (value: number) => 100 - ((value - lower) / (upper - lower)) * 100;
  return {
    duration,
    lower,
    upper,
    y,
    ticks: Array.from({ length: 5 }, (_, index) => lower + (upper - lower) * (index / 4)),
    series: series.map((series) => {
      let path = "";
      for (const [index, point] of series.points.entries()) {
        const left = (point.start / duration) * 100;
        const right = (point.end / duration) * 100;
        const top = y(point.value);
        const previous = series.points[index - 1];
        path +=
          previous && Math.abs(point.start - previous.end) <= 1e-6
            ? `V${top}H${right}`
            : `M${left},${top}H${right}`;
      }
      return { ...series, path };
    }),
  };
}

/** Bound decorative markers per visible range; paths still include every frame and spike. */
export function comparisonMarkers(points: FrameInterval[], range: ComparisonRange) {
  const visible = points.filter((point) => point.end >= range.start && point.start <= range.end);
  const stride = Math.max(1, Math.ceil(visible.length / 24));
  // Stride on each frame's own index so markers stay on their frames while panning.
  return visible.filter((point) => point.index % stride === 0);
}

export function comparisonFrameAt(
  chart: ReturnType<typeof comparisonFrames>,
  key: VariantKey,
  at: number,
) {
  const series = chart.series.find((series) => series.key === key);
  const last = series?.points.at(-1);
  return (
    series?.points.find((point) => at >= point.start && at < point.end) ??
    (at === chart.duration && last?.end === at ? last : null)
  );
}
