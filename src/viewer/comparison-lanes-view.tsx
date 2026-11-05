import { useMemo, useState } from "preact/hooks";
import type { VariantKey } from "../compare/model.ts";
import { formatMs } from "../format.ts";
import { formatCounter } from "../live/counters.ts";
import { Button } from "../ui/button.tsx";
import { comparisonDifference } from "./comparison-difference.ts";
import { ComparisonDifference } from "./comparison-difference-view.tsx";
import { comparisonFrameAt, type comparisonFrames } from "./comparison-frames.ts";
import { ComparisonHatch } from "./comparison-hatch.tsx";
import {
  type ComparisonLane,
  comparisonLaneGeometry,
  type comparisonLanes,
  comparisonLaneValues,
} from "./comparison-lanes.ts";
import { type ComparisonRange, comparisonWindow } from "./comparison-range.ts";
import { ComparisonTrack } from "./comparison-track.tsx";
import type { LaneValue } from "./lanes.ts";

type Chart = ReturnType<typeof comparisonFrames>;
type Model = ReturnType<typeof comparisonLanes>;
interface CursorProps {
  chart: Chart;
  at: number;
  onSelect: (at: number) => void;
  onHover: (at: number | null) => void;
  visible: Record<VariantKey, boolean>;
  range: ComparisonRange;
}

export function ComparisonLanes({ model, ...cursor }: CursorProps & { model: Model }) {
  return (
    <div class="mt-4 space-y-4">
      <p class="text-label-12 text-jank-text-secondary">
        A solid/round · B dashed/square · hatching marks unavailable or absent data · * retained
        partial CPU data, excluded from the line.
      </p>
      {(
        [
          ["cpu", "CPU scopes"],
          ["gpu", "GPU passes"],
          ["context", "Frame context"],
          ["counter", "Counters"],
        ] as const
      ).map(([group, title]) => (
        <ComparisonLaneGroup key={group} group={group} title={title} model={model} {...cursor} />
      ))}
    </div>
  );
}

function ComparisonLaneGroup({
  group,
  title,
  model,
  ...cursor
}: CursorProps & { group: ComparisonLane["group"]; title: string; model: Model }) {
  const [page, setPage] = useState(0);
  const lanes = model.lanes.filter((lane) => lane.group === group);
  const pages = Math.ceil(lanes.length / 16);
  const ceiling = group === "gpu" ? model.gpuCeiling : model.cpuCeiling;
  return (
    <section aria-label={`Comparison ${title}`} class="border-t border-jank-divider pt-3">
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="m-0 text-heading-14">{title}</h3>
        <p class="text-label-12 text-jank-text-secondary">
          {group === "counter"
            ? "Shared A/B scale per counter"
            : `0–${formatMs(ceiling)} · ${group === "gpu" ? "GPU clock" : "CPU clock"} · shared A/B scale`}
        </p>
      </div>
      {pages > 1 && (
        <div class="mb-2 flex items-center justify-end gap-2 text-label-12">
          <span>
            {page * 16 + 1}–{Math.min((page + 1) * 16, lanes.length)} of {lanes.length} lanes
          </span>
          <Button compact onPress={() => setPage(Math.max(0, page - 1))}>
            Previous lanes
          </Button>
          <Button compact onPress={() => setPage(Math.min(pages - 1, page + 1))}>
            Next lanes
          </Button>
        </div>
      )}
      {lanes.slice(page * 16, (page + 1) * 16).map((lane) => (
        <ComparisonLaneRow key={lane.id} lane={lane} model={model} ceiling={ceiling} {...cursor} />
      ))}
      {!lanes.length && (
        <p class="text-label-12 text-jank-text-secondary">
          {group === "gpu"
            ? "No per-invocation GPU timings retained. Legacy aggregates cannot populate pass lanes."
            : group === "counter"
              ? "No numeric counters supplied."
              : "No lanes retained for this pair."}
        </p>
      )}
      {group === "gpu" && lanes.length > 0 && (
        <p class="pt-2 text-label-12 text-jank-text-secondary">
          GPU durations are attached to host frames; their position does not locate GPU execution on
          the CPU clock.
        </p>
      )}
      {group === "context" && lanes.length > 0 && (
        <p class="pt-2 text-label-12 text-jank-text-secondary">
          Unattributed is frame time outside recorded CPU scopes, including waiting. Profiler cost
          can overlap scopes; do not add these lanes together.
        </p>
      )}
      {group === "counter" && lanes.length > 0 && (
        <p class="pt-2 text-label-12 text-jank-text-secondary">
          Counters use the latest sample at or before each frame start. Sample age is measured at
          frame start; values are never taken from a later sample.
        </p>
      )}
    </section>
  );
}

function ComparisonLaneRow({
  lane,
  model,
  ceiling,
  chart,
  at,
  onSelect,
  onHover,
  visible,
  range,
}: CursorProps & { lane: ComparisonLane; model: Model; ceiling: number }) {
  const window = comparisonWindow(range, chart.duration);
  const data = useMemo(() => {
    const series = model.sources.map((source) => {
      const frames = chart.series.find((series) => series.key === source.key);
      const points = frames?.points ?? [];
      return {
        key: source.key,
        points,
        reason: frames?.reason,
        values: comparisonLaneValues(source, lane, points),
      };
    });
    let low = lane.group === "counter" ? Infinity : 0;
    let high = lane.group === "counter" ? -Infinity : ceiling;
    let known = false;
    for (const entry of series)
      for (const cell of entry.values)
        if (cell.value !== null && cell.status === "measured") {
          known = true;
          low = Math.min(low, cell.value);
          high = Math.max(high, cell.value);
        }
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      low = 0;
      high = 0;
    }
    return {
      low,
      high,
      known,
      difference: comparisonDifference(
        series[0] ?? { points: [], values: [] },
        series[1] ?? { points: [], values: [] },
        chart.duration,
      ),
      series: series.map((series) => ({
        ...series,
        geometry: comparisonLaneGeometry(series.points, series.values, chart.duration, low, high),
      })),
    };
  }, [model, lane, ceiling, chart]);
  const format = (value: number) =>
    lane.group === "counter" ? formatCounter(lane.counter.key, value).text : formatMs(value, 2);
  const text = (cell: LaneValue) =>
    cell.value === null
      ? cell.status
      : `${format(cell.value)}${cell.status === "partial" ? "*" : ""}`;
  const selected = data.series.map((series) => {
    const frame = comparisonFrameAt(chart, series.key, at);
    const cell = frame ? series.values[frame.index] : undefined;
    return {
      ...series,
      cell: cell ?? {
        value: null,
        status: "missing" as const,
        reason: series.reason ?? "No recorded frame at this time.",
      },
    };
  });
  const readout = selected
    .map(({ key, cell }) =>
      visible[key]
        ? `${key}: ${text(cell)}. ${cell.reason}${"age" in cell && cell.age !== null && cell.age !== undefined ? `. Sample ${formatMs(cell.age)} before frame start.` : ""}`
        : `${key}: hidden`,
    )
    .join(" ");
  return (
    <>
      <div
        data-comparison-lane={lane.id}
        data-comparison-lane-group={lane.group}
        class="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 border-b border-jank-divider py-2"
      >
        <span
          class="row-span-2 truncate text-right text-label-12 text-jank-text-secondary"
          title={lane.description}
        >
          {lane.group === "counter" ? formatCounter(lane.counter.key, null).label : lane.label}
        </span>
        <div class="mb-1 flex min-h-8 items-start justify-between gap-2 text-label-12">
          <span class="min-w-0 truncate text-jank-text-secondary" title={lane.description}>
            {lane.group === "counter"
              ? `${lane.counter.systemLabel} · ${data.known ? `${formatCounter(lane.counter.key, data.low).text}–${formatCounter(lane.counter.key, data.high).text}` : "Range unavailable"}`
              : lane.description.split(" · ")[0]}
          </span>
          <div class="flex shrink-0 gap-3 font-mono">
            {selected.map(({ key, cell }) => (
              <p
                key={key}
                data-comparison-lane-readout={key}
                title={`${key}: ${text(cell)} · ${cell.reason}`}
                class={`max-w-32 ${key === "A" ? "text-jank-series-a" : "text-jank-series-b-text"}`}
              >
                <span class="block truncate">
                  <span aria-hidden="true">{key === "A" ? "● " : "■ "}</span>
                  {key} {visible[key] ? text(cell) : "hidden"}
                </span>
                {lane.group === "counter" && (
                  <span class="block font-sans text-jank-text-secondary">
                    {!visible[key]
                      ? "—"
                      : "age" in cell && cell.age !== null && cell.age !== undefined
                        ? `${formatMs(cell.age)} old`
                        : "No sample"}
                  </span>
                )}
              </p>
            ))}
          </div>
        </div>
        <ComparisonTrack
          range={range}
          at={at}
          onSelect={onSelect}
          onHover={onHover}
          label={`${lane.description} comparison lane`}
          readout={readout}
          className="h-10"
        >
          {data.series
            .filter(({ key }) => visible[key])
            .map(({ key, geometry }) => (
              <ComparisonHatch
                key={key}
                path={geometry.missing}
                series={key}
                range={range}
                duration={chart.duration}
              />
            ))}
          <svg
            aria-hidden="true"
            data-comparison-window=""
            viewBox={window.viewBox}
            preserveAspectRatio="none"
            class="pointer-events-none block size-full"
          >
            <path d="M0 100H100" class="stroke-jank-divider" vector-effect="non-scaling-stroke" />
            {data.series
              .filter(({ key }) => visible[key])
              .map(({ key, geometry }) => (
                <path
                  key={key}
                  data-comparison-lane-series={key}
                  d={geometry.path}
                  fill="none"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                  stroke-dasharray={key === "B" ? "5 4" : undefined}
                  class={key === "A" ? "stroke-jank-series-a" : "stroke-jank-series-b"}
                />
              ))}
          </svg>
          {selected
            .filter(({ key }) => visible[key])
            .map(
              ({ key, cell, geometry }) =>
                cell.value !== null &&
                cell.status === "measured" && (
                  <span
                    key={key}
                    aria-hidden="true"
                    class={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 ${key === "A" ? "size-2.5 rounded-full bg-jank-series-a" : "size-1.5 bg-jank-series-b"}`}
                    style={{
                      left: `${window.position(at)}%`,
                      top: `${geometry.y(cell.value)}%`,
                    }}
                  />
                ),
            )}
        </ComparisonTrack>
      </div>
      <ComparisonDifference
        model={data.difference}
        label={lane.description}
        format={format}
        duration={chart.duration}
        range={range}
        at={at}
        onSelect={onSelect}
        onHover={onHover}
      />
    </>
  );
}
