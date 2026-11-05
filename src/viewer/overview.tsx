import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { formatMs, formatSeconds } from "../format.ts";
import { frameChartGeometry } from "../frame-chart-geometry.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { FramePlot } from "./frame-plot.tsx";
import type { RecordingInspection } from "./inspection.ts";
import { selectRange, type ViewerSelection } from "./selection.ts";

export function RecordingOverview({
  recording,
  summary,
  selection,
  onChange,
  onSelect,
}: {
  recording: PerformanceRecording;
  summary: RecordingInspection;
  selection: ViewerSelection;
  onChange: (selection: ViewerSelection) => void;
  onSelect: (index: number) => void;
}) {
  const count = recording.frames.length;
  const drag = useRef<{
    pointer: number;
    anchor: number;
    original: ViewerSelection;
    mode: "start" | "end" | "move" | "brush";
  } | null>(null);
  useLayoutEffect(
    () => () => {
      drag.current = null;
    },
    [],
  );
  const chart = useMemo(
    () =>
      frameChartGeometry(
        recording.frames,
        recording.budget.frameMs,
        summary.overLimit,
        Math.max(1, count),
      ),
    [recording, summary, count],
  );
  const labels = summary.spikes
    .filter((spike) => spike.rank <= 3 || spike.index === selection.selected)
    .sort((a, b) => a.index - b.index);
  const rows: number[][] = [];
  const markers = labels.map((spike) => {
    const position = Math.max(6, Math.min(94, ((spike.index + 0.5) / count) * 100));
    let row = rows.findIndex((positions) =>
      positions.every((previous) => Math.abs(previous - position) >= 12),
    );
    if (row < 0) {
      row = rows.length;
      rows.push([]);
    }
    rows[row]?.push(position);
    return { ...spike, position, row };
  });
  const spikeTicks = useMemo(
    () => summary.spikes.map((spike) => `M${((spike.index + 0.5) / count) * 300},96v-6`).join(""),
    [summary, count],
  );
  const window = summary.window;
  const clipped =
    window &&
    ((window.before !== null && window.before < window.requestedBefore) ||
      (window.after !== null && window.after < window.requestedAfter));
  const position = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(count - 1, Math.floor(((x - bounds.left) / Math.max(1, bounds.width)) * count)),
    );
  };
  const update = (index: number) => {
    const held = drag.current;
    if (!held) return;
    if (held.mode === "move") {
      const width = held.original.end - held.original.start;
      const start = Math.max(
        0,
        Math.min(count - width - 1, held.original.start + index - held.anchor),
      );
      onChange(selectRange(held.original, start, start + width, count));
      return;
    }
    const next =
      held.mode === "start"
        ? Math.min(index, held.anchor)
        : held.mode === "end"
          ? Math.max(index, held.anchor)
          : index;
    onChange(selectRange(held.original, held.anchor, next, count));
  };
  return (
    <section
      aria-label="Recording overview"
      class="shrink-0 border-b border-jank-divider px-6 py-2"
    >
      <div class="mb-2 flex justify-between gap-3 text-label-12 text-jank-text-secondary">
        <span>
          Overview · {count.toLocaleString()} frames · {formatSeconds(summary.durationMs / 1000, 2)}
        </span>
        <span>Drag window to move · handles to resize · arrows adjust focused handle</span>
      </div>
      {window && (
        <div class="pb-2 text-label-12 text-purple-1000">
          <p>
            Capture window f{recording.frames[0]?.id} → f{recording.frames.at(-1)?.id}
            {clipped && " · context clipped"}
          </p>
          <div
            role="img"
            aria-label={`Retained capture window: ${count} frames${window.phases.length ? ` · ${window.phases.map((phase) => `${phase.label} ${phase.count}`).join(" · ")}` : " · phases unavailable"}`}
            class="mt-1 flex h-1 overflow-hidden rounded-full bg-purple-700"
          >
            {window.phases.map((phase) => (
              <span
                key={phase.label}
                title={`${phase.label}: ${phase.count} frames`}
                class={
                  phase.label === "Before onset"
                    ? "bg-purple-400"
                    : phase.label === "Qualifying"
                      ? "bg-purple-600"
                      : phase.label === "After"
                        ? "bg-purple-500"
                        : "bg-purple-800"
                }
                style={{ width: `${(phase.count / count) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}
      <fieldset
        aria-label="Visible frame range"
        class="relative m-0 h-16 min-w-0 cursor-crosshair touch-none p-0 select-none"
        data-overview-brush=""
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          const edge = (event.target as Element)
            .closest("[data-range-edge]")
            ?.getAttribute("data-range-edge");
          const handle = edge === "start" || edge === "end" ? edge : null;
          const index = position(event.currentTarget, event.clientX);
          drag.current = {
            pointer: event.pointerId,
            original: selection,
            mode: handle ?? (index >= selection.start && index <= selection.end ? "move" : "brush"),
            anchor: handle === "start" ? selection.end : handle === "end" ? selection.start : index,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget
            .querySelector<HTMLElement>(`[data-range-edge="${handle ?? "start"}"]`)
            ?.focus();
          if (!handle) update(index);
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
          // Capture can be lost before pointerup; keep the last position unless cancelled.
          if (drag.current?.pointer === event.pointerId) drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !drag.current) return;
          event.preventDefault();
          event.stopPropagation();
          const pointer = drag.current.pointer;
          onChange(drag.current.original);
          drag.current = null;
          event.currentTarget.releasePointerCapture(pointer);
        }}
      >
        <FramePlot chart={chart} selected={selection.selected} />
        <svg
          aria-hidden="true"
          viewBox="0 0 300 96"
          preserveAspectRatio="none"
          class="pointer-events-none absolute inset-0 size-full"
        >
          <path d={spikeTicks} class="stroke-jank-over" stroke-width="1" />
        </svg>
        <div
          aria-hidden="true"
          class="absolute inset-y-0 cursor-grab border border-jank-focus bg-gray-alpha-100 active:cursor-grabbing"
          data-visible-range=""
          style={{
            left: `${(selection.start / count) * 100}%`,
            width: `${((selection.end - selection.start + 1) / count) * 100}%`,
          }}
        />
        {(["start", "end"] as const).map((edge) => (
          <div
            key={edge}
            role="slider"
            tabIndex={0}
            data-range-edge={edge}
            aria-label={edge === "start" ? "First visible frame" : "Last visible frame"}
            aria-orientation="horizontal"
            aria-valuemin={edge === "start" ? 0 : selection.start}
            aria-valuemax={edge === "start" ? selection.end : count - 1}
            aria-valuenow={selection[edge]}
            aria-valuetext={`Frame ${recording.frames[selection[edge]]?.id}`}
            class="focus-ring absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center rounded-xs bg-jank-focus text-jank-surface"
            style={{
              left: `clamp(0px, calc(${((selection[edge] + (edge === "end" ? 1 : 0)) / count) * 100}% - 6px), calc(100% - 12px))`,
            }}
            onKeyDown={(event) => {
              if (
                event.ctrlKey ||
                event.altKey ||
                event.metaKey ||
                event.shiftKey ||
                event.isComposing
              )
                return;
              const min = edge === "start" ? 0 : selection.start;
              const max = edge === "start" ? selection.end : count - 1;
              let index = selection[edge];
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") index--;
              else if (event.key === "ArrowRight" || event.key === "ArrowUp") index++;
              else if (event.key === "Home") index = min;
              else if (event.key === "End") index = max;
              else return;
              event.preventDefault();
              event.stopPropagation();
              onChange(
                selectRange(
                  selection,
                  edge === "start" ? Math.max(min, Math.min(max, index)) : selection.start,
                  edge === "end" ? Math.max(min, Math.min(max, index)) : selection.end,
                  count,
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
        ))}
      </fieldset>
      {markers.length > 0 && (
        <fieldset
          class="relative m-0 min-w-0 p-0"
          style={{ height: `${rows.length * 24}px` }}
          aria-label="Ranked spike markers"
        >
          {markers.map((spike) => (
            <button
              key={spike.index}
              type="button"
              aria-label={`Spike ${spike.rank}, frame ${spike.frame.id}, ${spike.frame.interval.toFixed(1)} milliseconds`}
              title={`Spike ${spike.rank} · f${spike.frame.id} · ${formatMs(spike.frame.interval)}`}
              class="focus-ring absolute w-[12%] -translate-x-1/2 truncate rounded-xs text-center font-mono text-label-12 text-jank-over hover:underline"
              style={{ left: `${spike.position}%`, top: `${spike.row * 24}px` }}
              onClick={() => onSelect(spike.index)}
            >
              ▲{spike.rank} f{spike.frame.id}
            </button>
          ))}
        </fieldset>
      )}
      {summary.spikes.length > 3 && (
        <p class="text-label-12 text-jank-text-secondary">
          Top 3 and selected spike labelled; J/K visits all {summary.spikes.length} spikes.
        </p>
      )}
    </section>
  );
}
