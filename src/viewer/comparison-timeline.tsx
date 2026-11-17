import { useMemo } from "preact/hooks";
import type { ComparisonBundle, VariantKey } from "../compare/model.ts";
import { formatMs, withUnit } from "../format.ts";
import { comparisonDifference } from "./comparison-difference.ts";
import { ComparisonDifference } from "./comparison-difference-view.tsx";
import {
  comparisonFrameAt,
  type comparisonFrames,
  comparisonMarkers,
} from "./comparison-frames.ts";
import type { comparisonLanes } from "./comparison-lanes.ts";
import { ComparisonLanes } from "./comparison-lanes-view.tsx";
import { ComparisonOverview } from "./comparison-overview.tsx";
import { type ComparisonSelection, comparisonWindow } from "./comparison-range.ts";
import { ComparisonTrack } from "./comparison-track.tsx";

export function ComparisonTimeline({
  bundle,
  chart,
  lanes,
  selection,
  onSelection,
  hover,
  onHover,
  visible,
}: {
  bundle: ComparisonBundle;
  chart: ReturnType<typeof comparisonFrames>;
  lanes: ReturnType<typeof comparisonLanes>;
  selection: ComparisonSelection;
  onSelection: (selection: ComparisonSelection) => void;
  hover: number | null;
  onHover: (at: number | null) => void;
  visible: Record<VariantKey, boolean>;
}) {
  const difference = useMemo(() => {
    const series = chart.series.map((series) => ({
      points: series.points,
      values: series.points.map((point) => ({
        value: point.value,
        status: "measured" as const,
        reason: "Recorded frame interval",
      })),
    }));
    return comparisonDifference(
      series[0] ?? { points: [], values: [] },
      series[1] ?? { points: [], values: [] },
      chart.duration,
    );
  }, [chart]);
  const at = hover ?? selection.at;
  const setAt = (at: number) => onSelection({ ...selection, at });
  const window = comparisonWindow(selection, chart.duration);
  const values = chart.series.map((series) => ({
    ...series,
    frame: comparisonFrameAt(chart, series.key, at),
  }));
  const readout = values
    .map(
      ({ key, frame, reason }) =>
        `${key}: ${!visible[key] ? "hidden" : frame ? `f${frame.id}, ${formatMs(frame.value)}` : (reason ?? "No frame at this time")}`,
    )
    .join(". ");
  const time = withUnit((at / 1000).toFixed(3), "s");
  const budgetY = chart.y(bundle.budgetMs);
  return (
    <div class="min-w-0 p-6">
      <ComparisonOverview
        chart={chart}
        selection={selection}
        onChange={onSelection}
        visible={visible}
      />
      <section aria-label="Aligned frame times" class="space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 class="m-0 text-heading-14">Frame time</h2>
            <p class="text-label-12 text-jank-text-secondary">
              ms{chart.lower > 0 ? " · zoomed" : ""}
            </p>
          </div>
          <p class="font-mono text-label-12 text-jank-text-secondary">at {time}</p>
        </div>
        <div class="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 pt-2">
          <div
            aria-hidden="true"
            class="relative h-80 font-mono text-label-12 text-jank-text-secondary"
          >
            {chart.ticks
              .filter((tick) => Math.abs(chart.y(tick) - budgetY) > 6)
              .map((tick) => (
                <span
                  key={tick}
                  class="absolute right-0 -translate-y-1/2"
                  style={{ top: `${chart.y(tick)}%` }}
                >
                  {tick >= 10000 ? tick.toPrecision(3) : Number(tick.toFixed(1))}
                </span>
              ))}
            <span
              class="absolute right-0 -translate-y-1/2 whitespace-nowrap text-jank-text"
              style={{ top: `${budgetY}%` }}
            >
              budget {Number(bundle.budgetMs.toFixed(1))}
            </span>
            {chart.lower > 0 && (
              <svg
                aria-hidden="true"
                data-axis-break=""
                viewBox="0 0 16 8"
                class="absolute -bottom-1 -right-5 h-2 w-4"
                fill="none"
              >
                <path d="M0 7L4 1L8 7L12 1L16 7" stroke="currentColor" />
              </svg>
            )}
          </div>
          <ComparisonTrack
            range={selection}
            at={at}
            onSelect={setAt}
            onHover={onHover}
            label="Comparison elapsed time"
            readout={readout}
            className="h-80"
          >
            <svg
              data-comparison-window=""
              viewBox={window.viewBox}
              preserveAspectRatio="none"
              aria-hidden="true"
              class="pointer-events-none block size-full"
            >
              <rect x="0" y="0" width="100" height={budgetY} class="fill-jank-over-band" />
              {chart.ticks.map((tick) => (
                <path
                  key={tick}
                  d={`M0,${chart.y(tick)}H100`}
                  class="stroke-jank-divider"
                  vector-effect="non-scaling-stroke"
                />
              ))}
              <path
                d={`M0,${budgetY}H100`}
                class="stroke-jank-budget-line"
                vector-effect="non-scaling-stroke"
                stroke-dasharray="4 4"
              />
              {chart.series
                .filter((series) => visible[series.key])
                .map((series) => (
                  <path
                    key={series.key}
                    data-comparison-series={series.key}
                    d={series.path}
                    fill="none"
                    stroke-width="1.5"
                    vector-effect="non-scaling-stroke"
                    stroke-dasharray={series.key === "B" ? "5 4" : undefined}
                    class={series.key === "A" ? "stroke-jank-series-a" : "stroke-jank-series-b"}
                  />
                ))}
            </svg>
            {chart.series
              .filter((series) => visible[series.key])
              .flatMap((series) =>
                comparisonMarkers(series.points, selection).map((point) => {
                  const left = window.position(
                    point.start + (point.end - point.start) * (series.key === "A" ? 0.3 : 0.7),
                  );
                  return left >= 0 && left <= 100 ? (
                    <span
                      key={`${series.key}-${point.id}`}
                      data-comparison-marker={series.key}
                      aria-hidden="true"
                      class={`pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 ${series.key === "A" ? "rounded-full bg-jank-series-a" : "bg-jank-series-b"}`}
                      style={{
                        left: `${left}%`,
                        top: `${chart.y(point.value)}%`,
                      }}
                    />
                  ) : null;
                }),
              )}
          </ComparisonTrack>
          <div />
          <div class="flex justify-between pt-2 font-mono text-label-12 text-jank-text-secondary">
            {[
              selection.start,
              selection.start + (selection.end - selection.start) / 2,
              selection.end,
            ].map((time) => (
              <span key={time}>{withUnit((time / 1000).toFixed(3), "s")}</span>
            ))}
          </div>
        </div>
        <section
          aria-label="Comparison frame readout"
          class="grid grid-cols-2 gap-3 border-t border-jank-divider pt-2 font-mono text-label-12"
        >
          {values.map(({ key, frame, reason }) => (
            <p
              key={key}
              data-comparison-readout={key}
              class={key === "A" ? "text-jank-series-a" : "text-jank-series-b-text"}
            >
              <strong>{key}</strong>{" "}
              {!visible[key] ? "hidden" : frame ? `${formatMs(frame.value)} · f${frame.id}` : "—"}
              <span class="block min-h-8 font-sans text-jank-text-secondary">
                {!visible[key]
                  ? "Hidden from the graph."
                  : frame
                    ? `${withUnit((frame.start / 1000).toFixed(3), "s")}–${withUnit((frame.end / 1000).toFixed(3), "s")} since measure start`
                    : (reason ?? "No recorded frame at this time.")}
              </span>
            </p>
          ))}
        </section>
        <p class="text-label-12 text-jank-text-secondary">
          Aligned from measure start; warm-up excluded. Each value covers its recorded frame
          interval. Gaps stay empty. A and B frame IDs are independent.
        </p>
      </section>
      <ComparisonDifference
        model={difference}
        label="Frame time"
        format={(value) => formatMs(value, 2)}
        duration={chart.duration}
        range={selection}
        at={at}
        onSelect={setAt}
        onHover={onHover}
      />
      <p class="pt-2 text-label-12 text-jank-text-secondary">
        B − A: positive means B is higher; negative means B is lower. Differences need measured
        values on both sides. Visibility does not change scales, differences or results.
      </p>
      <ComparisonLanes
        model={lanes}
        chart={chart}
        at={at}
        onSelect={setAt}
        onHover={onHover}
        visible={visible}
        range={selection}
      />
    </div>
  );
}
