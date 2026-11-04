import { useId, useMemo, useState } from "preact/hooks";
import { formatMs } from "../format.ts";
import { formatCounter } from "../live/counters.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { DismissIcon } from "../ui/icons.tsx";
import { MAX_PINNED_COUNTERS } from "./counter-details.tsx";
import {
  type Counter,
  type CounterModel,
  counterGeometry,
  readCounter,
} from "./inspector-model.ts";
import { FrameTrack } from "./lane-row.tsx";
import type { ViewerSelection } from "./selection.ts";

export function PinnedCounters({
  model,
  recording,
  selection,
  pins,
  onPin,
  onSelect,
}: {
  model: CounterModel;
  recording: PerformanceRecording;
  selection: ViewerSelection;
  pins: string[];
  onPin: (id: string) => void;
  onSelect: (index: number) => void;
}) {
  const id = useId();
  const [candidate, setCandidate] = useState("");
  const numeric = model.counters.filter((counter) => counter.numeric);
  return (
    <section aria-label="Pinned counters" class="mt-3 border-t border-jank-divider pt-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="m-0 text-label-13 font-medium">
          Pinned counters{" "}
          <span class="text-jank-text-secondary">
            {pins.length}/{MAX_PINNED_COUNTERS}
          </span>
        </h3>
        {numeric.length > 0 && (
          <form
            class="flex min-w-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (candidate && !pins.includes(candidate) && pins.length < MAX_PINNED_COUNTERS) {
                onPin(candidate);
                setCandidate("");
              }
            }}
          >
            <label for={id} class="sr-only">
              Counter to pin
            </label>
            <select
              id={id}
              value={candidate}
              onChange={(event) => setCandidate(event.currentTarget.value)}
              class="focus-ring h-8 min-w-0 max-w-64 rounded-md border border-jank-control bg-jank-surface px-2 text-label-12"
            >
              <option value="">Choose a counter…</option>
              {numeric.map((counter) => (
                <option key={counter.id} value={counter.id} disabled={pins.includes(counter.id)}>
                  {counter.systemLabel} · {counter.key}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={
                !candidate || pins.includes(candidate) || pins.length >= MAX_PINNED_COUNTERS
              }
              class="focus-ring h-8 rounded-md border border-jank-divider px-2 text-label-13 disabled:text-jank-text-disabled"
            >
              Pin
            </button>
          </form>
        )}
      </div>
      {pins.map((key) => {
        const counter = model.counters.find((item) => item.id === key);
        return counter ? (
          <CounterLane
            key={key}
            counter={counter}
            model={model}
            recording={recording}
            selection={selection}
            onSelect={onSelect}
            onPin={onPin}
          />
        ) : null;
      })}
      {!pins.length && (
        <p class="text-label-12 text-jank-text-secondary">
          {numeric.length
            ? "Pin a numeric counter here or in the Frame inspector. Values use samples at or before frame start."
            : "No numeric counters supplied."}
        </p>
      )}
    </section>
  );
}

function CounterLane({
  counter,
  model,
  recording,
  selection,
  onSelect,
  onPin,
}: {
  counter: Counter;
  model: CounterModel;
  recording: PerformanceRecording;
  selection: ViewerSelection;
  onSelect: (index: number) => void;
  onPin: (id: string) => void;
}) {
  const { start, end, selected } = selection;
  const series = useMemo(() => {
    const values = recording.frames.map((frame) => {
      const value = readCounter(model, counter, frame.at - frame.interval).value;
      return typeof value === "number" ? value : null;
    });
    const known = values.filter((value): value is number => value !== null);
    return {
      values,
      low: known.length ? Math.min(...known) : null,
      high: known.length ? Math.max(...known) : null,
    };
  }, [recording, model, counter]);
  const geometry = useMemo(
    () => counterGeometry(series.values.slice(start, end + 1), series.low ?? 0, series.high ?? 0),
    [series, start, end],
  );
  const frame = recording.frames[selected];
  const sample = readCounter(model, counter, frame ? frame.at - frame.interval : -Infinity);
  const formatted = formatCounter(counter.key, sample.value ?? null);
  const text = `${formatted.text} · ${sample.age === null ? sample.reason : `${formatMs(sample.age)} old`}`;
  return (
    <div data-counter-lane={counter.id} class="border-b border-jank-divider">
      <p class="text-right text-label-12 text-jank-text-secondary">
        {series.low === null || series.high === null
          ? "Range unavailable"
          : `${formatCounter(counter.key, series.low).text} – ${formatCounter(counter.key, series.high).text}`}{" "}
        · {counter.systemLabel}
      </p>
      <div class="grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] items-center gap-x-3">
        <div class="flex min-w-0 items-center justify-end gap-1 text-label-12 text-jank-text-secondary">
          <span class="truncate" title={counter.key}>
            {formatted.label}
          </span>
          <button
            type="button"
            aria-label={`Unpin ${counter.systemLabel} ${counter.key} lane`}
            class="focus-ring inline-grid size-5 shrink-0 place-items-center rounded-xs hover:bg-gray-alpha-200 hover:text-jank-text"
            onClick={(event) => {
              event.currentTarget
                .closest('[aria-label="Pinned counters"]')
                ?.querySelector("select")
                ?.focus();
              onPin(counter.id);
            }}
          >
            <DismissIcon />
          </button>
        </div>
        <FrameTrack
          recording={recording}
          selection={selection}
          onSelect={onSelect}
          label={`${counter.systemLabel} ${counter.key} counter lane`}
          valueText={`Frame ${frame?.id}: ${text}`}
          className="h-8"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 300 40"
            preserveAspectRatio="none"
            class="block size-full"
          >
            <path
              d={geometry.line}
              fill="none"
              class="stroke-jank-bar"
              vector-effect="non-scaling-stroke"
            />
            <path d={geometry.missing} class="stroke-jank-text-secondary" data-counter-missing="" />
          </svg>
        </FrameTrack>
        <span class="truncate text-right font-mono text-label-12" title={text}>
          {formatted.text}
        </span>
      </div>
    </div>
  );
}
