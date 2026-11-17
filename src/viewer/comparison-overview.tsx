import { useRef } from "preact/hooks";
import type { VariantKey } from "../compare/model.ts";
import { withUnit } from "../format.ts";
import { Button } from "../ui/button.tsx";
import type { comparisonFrames } from "./comparison-frames.ts";
import {
  type ComparisonSelection,
  fitComparisonRange,
  minimumComparisonRange,
  panComparisonRange,
  selectComparisonRange,
  zoomComparisonRange,
} from "./comparison-range.ts";

export function ComparisonOverview({
  chart,
  selection,
  onChange,
  visible,
}: {
  chart: ReturnType<typeof comparisonFrames>;
  selection: ComparisonSelection;
  onChange: (selection: ComparisonSelection) => void;
  visible: Record<VariantKey, boolean>;
}) {
  const drag = useRef<{
    pointer: number;
    anchor: number;
    offset: number;
    original: ComparisonSelection;
    mode: "start" | "end" | "move" | "brush";
  } | null>(null);
  const minimum = minimumComparisonRange(chart.duration);
  const format = (at: number) => withUnit((at / 1000).toFixed(3), "s");
  const position = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - bounds.left) / Math.max(1, bounds.width))) * chart.duration;
  };
  const update = (at: number) => {
    const held = drag.current;
    if (!held) return;
    at += held.offset;
    // A click selects nothing: only moving away from the anchor brushes a new range.
    if (held.mode === "brush" && at === held.anchor) {
      onChange(held.original);
      return;
    }
    onChange(
      held.mode === "move"
        ? panComparisonRange(held.original, at - held.anchor, chart.duration)
        : selectComparisonRange(
            held.original,
            held.anchor,
            held.mode === "start"
              ? Math.min(at, held.anchor - minimum)
              : held.mode === "end"
                ? Math.max(at, held.anchor + minimum)
                : at,
            chart.duration,
          ),
    );
  };
  return (
    <section
      aria-label="Comparison overview"
      class="mb-4 space-y-2 border-b border-jank-divider pb-3"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p data-comparison-range-readout="" class="font-mono text-label-12">
          {format(selection.start)}–{format(selection.end)} · since measure start
        </p>
        <div class="flex gap-2">
          <Button
            compact
            onPress={() => onChange(zoomComparisonRange(selection, 0.5, chart.duration))}
          >
            Zoom in
          </Button>
          <Button
            compact
            onPress={() => onChange(zoomComparisonRange(selection, 2, chart.duration))}
          >
            Zoom out
          </Button>
          <Button
            compact
            onPress={() => onChange(fitComparisonRange(chart.duration, selection.at))}
          >
            Fit
          </Button>
        </div>
      </div>
      <fieldset
        aria-label="Visible comparison time range"
        data-comparison-brush=""
        class="relative m-0 h-16 min-w-0 cursor-crosshair touch-none p-0 select-none"
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          const edge = (event.target as Element)
            .closest("[data-range-edge]")
            ?.getAttribute("data-range-edge");
          const handle = edge === "start" || edge === "end" ? edge : null;
          const at = position(event.currentTarget, event.clientX);
          drag.current = {
            pointer: event.pointerId,
            original: selection,
            offset: handle ? selection[handle] - at : 0,
            mode: handle ?? (at >= selection.start && at <= selection.end ? "move" : "brush"),
            anchor: handle === "start" ? selection.end : handle === "end" ? selection.start : at,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget
            .querySelector<HTMLElement>(`[data-range-edge="${handle ?? "start"}"]`)
            ?.focus({ preventScroll: true });
          if (!handle) update(at);
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer === event.pointerId)
            update(position(event.currentTarget, event.clientX));
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          update(position(event.currentTarget, event.clientX));
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          if (drag.current) onChange(drag.current.original);
          drag.current = null;
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointer === event.pointerId) drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !drag.current) return;
          event.preventDefault();
          event.stopPropagation();
          const held = drag.current;
          drag.current = null;
          onChange(held.original);
          event.currentTarget.releasePointerCapture(held.pointer);
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          class="pointer-events-none block size-full"
        >
          {chart.series
            .filter((series) => visible[series.key])
            .map((series) => (
              <path
                key={series.key}
                d={series.path}
                fill="none"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
                stroke-dasharray={series.key === "B" ? "5 4" : undefined}
                class={series.key === "A" ? "stroke-jank-series-a" : "stroke-jank-series-b"}
              />
            ))}
        </svg>
        <div
          aria-hidden="true"
          data-comparison-visible-range=""
          class="absolute inset-y-0 cursor-grab border border-jank-focus bg-gray-alpha-100 active:cursor-grabbing"
          style={{
            left: `${(selection.start / chart.duration) * 100}%`,
            width: `${((selection.end - selection.start) / chart.duration) * 100}%`,
          }}
        />
        {(["start", "end"] as const).map((edge) => {
          const min = edge === "start" ? 0 : selection.start + minimum;
          const max = edge === "start" ? selection.end - minimum : chart.duration;
          return (
            <div
              key={edge}
              role="slider"
              tabIndex={0}
              data-range-edge={edge}
              aria-label={edge === "start" ? "Visible time start" : "Visible time end"}
              aria-orientation="horizontal"
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={selection[edge]}
              aria-valuetext={`${format(selection[edge])} since measurement start`}
              class="focus-ring absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center rounded-xs bg-jank-focus text-jank-surface"
              style={{
                left: `clamp(0px, calc(${(selection[edge] / chart.duration) * 100}% - 6px), calc(100% - 12px))`,
              }}
              onKeyDown={(event) => {
                if (
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.isComposing ||
                  drag.current
                )
                  return;
                const step = Math.max(minimum, chart.duration / 1000);
                const next =
                  event.key === "Home"
                    ? min
                    : event.key === "End"
                      ? max
                      : event.key === "ArrowLeft" || event.key === "ArrowDown"
                        ? selection[edge] - step
                        : event.key === "ArrowRight" || event.key === "ArrowUp"
                          ? selection[edge] + step
                          : event.key === "PageDown"
                            ? selection[edge] - chart.duration / 10
                            : event.key === "PageUp"
                              ? selection[edge] + chart.duration / 10
                              : null;
                if (next === null) return;
                event.preventDefault();
                event.stopPropagation();
                const at = Math.max(min, Math.min(max, next));
                onChange(
                  selectComparisonRange(
                    selection,
                    edge === "start" ? at : selection.start,
                    edge === "end" ? at : selection.end,
                    chart.duration,
                  ),
                );
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 6 14" class="h-3.5 w-1.5 fill-current">
                <circle cx="1" cy="1" r="1" />
                <circle cx="5" cy="1" r="1" />
                <circle cx="1" cy="7" r="1" />
                <circle cx="5" cy="7" r="1" />
                <circle cx="1" cy="13" r="1" />
                <circle cx="5" cy="13" r="1" />
              </svg>
            </div>
          );
        })}
      </fieldset>
      <p class="text-label-12 text-jank-text-secondary">
        Drag window to pan · handles to resize · drag outside to select · Escape cancels
      </p>
    </section>
  );
}
