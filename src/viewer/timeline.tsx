import { useMemo, useState } from "preact/hooks";
import { formatMs } from "../format.ts";
import { frameChartGeometry } from "../frame-chart-geometry.ts";
import { eventPosition } from "../live/events.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { Button } from "../ui/button.tsx";
import { ChevronIcon } from "../ui/icons.tsx";
import { FramePlot } from "./frame-plot.tsx";
import type { CounterModel } from "./inspector-model.ts";
import { LaneGroup } from "./lane-group.tsx";
import { FrameCursor, FrameTrack } from "./lane-row.tsx";
import { laneGeometry, type recordingLanes } from "./lanes.ts";
import { PinnedCounters } from "./pinned-counters.tsx";
import type { ViewerSelection } from "./selection.ts";

export function RecordingTimeline({
  recording,
  selection,
  overLimit,
  model,
  counters,
  pins,
  onPin,
  onSelect,
}: {
  recording: PerformanceRecording;
  selection: ViewerSelection;
  overLimit: number;
  model: ReturnType<typeof recordingLanes>;
  counters: CounterModel;
  pins: string[];
  onPin: (id: string) => void;
  onSelect: (index: number) => void;
}) {
  const { start, end, selected } = selection;
  const [expand, setExpand] = useState(false);
  const [visible, setVisible] = useState({ events: true, cpu: true, gpu: true, context: true });
  const chart = useMemo(() => {
    const frames = recording.frames.slice(start, end + 1);
    const budget = recording.budget.frameMs;
    const peak = Math.max(budget * 4, ...frames.map((frame) => frame.interval));
    const geometry = frameChartGeometry(
      frames,
      budget,
      overLimit,
      frames.length,
      Math.min(Number.MAX_VALUE, Math.ceil(peak / budget) * budget),
    );
    return {
      ...geometry,
      bars: laneGeometry(
        frames.map((frame) => ({
          value: frame.interval,
          status: "measured",
          reason: "Frame interval",
        })),
        geometry.ceiling,
      ).bars,
    };
  }, [recording, start, end, overLimit]);
  const frame = recording.frames[selected];
  if (!frame) return null;
  const budget = recording.budget.frameMs;
  const ticks = [0, budget, budget * 2, budget * 3, budget * 4];
  if (chart.ceiling > budget * 4) ticks.push(chart.ceiling);
  const events = model.events.filter(
    (event) => event.frameIndex >= start && event.frameIndex <= end,
  );
  const eventFrames = [...new Set(events.map((event) => event.frameIndex))];
  const selectedEvents = model.events.filter((event) => event.frameIndex === selected);
  const unmatched = model.events.filter((event) => event.frameIndex < 0);
  return (
    <section aria-label="Recording timeline" class="min-w-0 p-6">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-label-12 text-jank-text-secondary">
        <p>▧ no record · ✕ rejected · — pending · dotted unknown · * partial</p>
        <div class="flex items-center gap-2">
          <Button compact pressed={expand} onPress={() => setExpand(!expand)}>
            Expand quiet lanes
          </Button>
          <details
            class="group relative"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }}
          >
            <summary class="focus-ring flex cursor-pointer items-center gap-1.5 rounded-md border border-jank-divider px-2 py-1 text-jank-text">
              <ChevronIcon class="group-open:rotate-90" />
              Lanes
            </summary>
            <div class="absolute top-full right-0 z-10 mt-1 w-48 space-y-2 rounded-md border border-jank-divider bg-jank-surface p-3 shadow-lg">
              {(
                [
                  ["events", "Events"],
                  ["cpu", "CPU scopes"],
                  ["gpu", "GPU passes"],
                  ["context", "Frame context"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} class="flex items-center gap-2 text-jank-text">
                  <input
                    type="checkbox"
                    checked={visible[key]}
                    class="focus-ring accent-jank-focus"
                    onChange={(event) =>
                      setVisible({ ...visible, [key]: event.currentTarget.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <label class="flex items-center gap-2 text-jank-text">
                <input
                  type="checkbox"
                  checked={expand}
                  class="focus-ring accent-jank-focus"
                  onChange={(event) => setExpand(event.currentTarget.checked)}
                />
                Expand quiet lanes
              </label>
            </div>
          </details>
        </div>
      </div>
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <h2 class="m-0 text-label-13 font-medium">Frame time</h2>
        <span class="text-label-12 text-jank-text-secondary">
          ms · budget multiples · at f{frame.id}
        </span>
      </div>
      <div class="grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] gap-x-3">
        <div
          aria-hidden="true"
          class="relative h-64 font-mono text-label-12 text-jank-text-secondary"
        >
          {ticks.map((value) => (
            <span
              key={value}
              class="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${100 - (value / chart.ceiling) * 100}%` }}
            >
              {value === 0
                ? "0"
                : value === budget
                  ? "budget "
                  : `${(value / budget).toFixed(0)}× `}
              {value > 0 && value.toFixed(1)}
            </span>
          ))}
        </div>
        <FrameTrack
          recording={recording}
          selection={selection}
          onSelect={onSelect}
          label="Selected frame"
          valueText={`Frame ${frame.id}, ${frame.interval.toFixed(1)} milliseconds`}
          className="h-64"
        >
          <FramePlot chart={chart} selected={selected - start} multiples bars={chart.bars} />
        </FrameTrack>
        <p class="text-right font-mono text-label-12 text-jank-over">
          {(frame.interval / budget).toFixed(1)}×
          <span class="block font-sans text-jank-text-secondary">budget</span>
        </p>
      </div>
      {visible.events && (
        <section aria-label="Recording events">
          <div class="grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] items-center gap-x-3">
            <span class="text-right text-label-12 text-jank-text-secondary">Events</span>
            <div class="relative h-6 border-y border-jank-divider" data-event-lane="">
              {eventFrames.map((index) => {
                const items = events.filter((event) => event.frameIndex === index);
                const description = items
                  .map(
                    (event) =>
                      `${event.label || "Untitled event"}${event.detail ? ` · ${event.detail}` : ""}`,
                  )
                  .join("; ");
                return (
                  <button
                    key={index}
                    type="button"
                    aria-label={`Events at frame ${recording.frames[index]?.id}: ${description}`}
                    title={description}
                    class="focus-ring absolute top-0 -translate-x-1/2 rounded-xs text-label-13 text-jank-text-secondary hover:text-jank-text"
                    style={{ left: `${((index - start + 0.5) / (end - start + 1)) * 100}%` }}
                    onFocus={() => onSelect(index)}
                    onClick={() => onSelect(index)}
                    onKeyDown={(event) => {
                      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing)
                        return;
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End", "j", "k", "w"].includes(
                          event.key,
                        )
                      ) {
                        // Keep keyboard navigation focused when a new range removes this marker.
                        event.currentTarget
                          .closest('[aria-label="Recording timeline"]')
                          ?.querySelector<HTMLElement>('[aria-label="Selected frame"]')
                          ?.focus();
                      }
                    }}
                  >
                    ◆
                  </button>
                );
              })}
              <FrameCursor selection={selection} />
            </div>
            <span class="text-right font-mono text-label-12">{selectedEvents.length || "—"}</span>
          </div>
          {selectedEvents.length > 0 && (
            <p class="pt-1 text-copy-13 wrap-anywhere" data-viewer-event-readout="">
              {selectedEvents
                .map(
                  (event) =>
                    `${event.label || "Untitled event"} · ${eventPosition(event)}${event.detail ? ` · ${event.detail}` : ""}`,
                )
                .join("; ")}
            </p>
          )}
          {unmatched.length > 0 && (
            <details class="group py-1 text-label-12 text-jank-text-secondary">
              <summary class="focus-ring flex cursor-pointer items-center gap-1.5">
                <ChevronIcon class="group-open:rotate-90" />
                {unmatched.length} {unmatched.length === 1 ? "event" : "events"} without a matching
                frame
              </summary>
              <ul class="max-h-40 overflow-y-auto pl-4">
                {unmatched.map((event) => (
                  <li key={event.id}>
                    {event.label} · {eventPosition(event)} · {event.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <div
        class="mt-2 flex justify-between gap-2 border-t border-jank-divider pt-1 font-mono text-label-12 text-jank-text-secondary"
        data-frame-readout=""
      >
        <span>
          f{frame.id} · {formatMs(frame.interval)} · {(frame.interval / budget).toFixed(1)}× budget
        </span>
        <span>
          f{recording.frames[start]?.id}–f{recording.frames[end]?.id}
        </span>
      </div>
      {visible.cpu && (
        <LaneGroup
          label="CPU scopes"
          lanes={model.cpu}
          model={model}
          recording={recording}
          selection={selection}
          onSelect={onSelect}
          expand={expand}
        />
      )}
      {visible.gpu && (
        <LaneGroup
          label="GPU passes"
          lanes={model.gpu}
          model={model}
          recording={recording}
          selection={selection}
          onSelect={onSelect}
          expand={expand}
        />
      )}
      {visible.context && (
        <LaneGroup
          label="Frame context"
          lanes={model.context}
          model={model}
          recording={recording}
          selection={selection}
          onSelect={onSelect}
          expand={expand}
        />
      )}
      <PinnedCounters
        model={counters}
        recording={recording}
        selection={selection}
        pins={pins}
        onPin={onPin}
        onSelect={onSelect}
      />
      <p class="mt-2 text-label-12 text-jank-text-secondary">
        CPU lanes can overlap; context is not additive. GPU pass durations are on a separate clock,
        not device busy time. Use Expand quiet lanes for larger CPU/context tracks.
      </p>
    </section>
  );
}
