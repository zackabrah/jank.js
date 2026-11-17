import { useId, useState } from "preact/hooks";
import { formatMs } from "../format.ts";
import { formatCounter } from "../live/counters.ts";
import { Button } from "../ui/button.tsx";
import { type CounterModel, readCounter } from "./inspector-model.ts";

export const MAX_PINNED_COUNTERS = 4;

export function CounterDetails({
  model,
  at,
  pins = [],
  onPin,
}: {
  model: CounterModel;
  at: number;
  pins?: string[] | undefined;
  onPin?: ((id: string) => void) | undefined;
}) {
  const hint = useId();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const counters = model.counters.filter((counter) =>
    `${counter.systemLabel} ${counter.key}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section aria-label="Frame counters" class="space-y-2 border-t border-jank-divider pt-3">
      <h3 class="m-0 text-label-13 font-medium">
        Counters <span class="text-jank-text-secondary">· at frame start</span>
      </h3>
      <p id={hint} class="text-label-12 text-jank-text-secondary">
        Δ compares the previous retained sample.
        {onPin && ` Pin up to ${MAX_PINNED_COUNTERS} numeric counters.`}
      </p>
      {model.counters.length ? (
        <>
          <input
            type="search"
            aria-label="Filter counters"
            value={filter}
            placeholder="Filter by system or counter"
            class="focus-ring h-8 w-full rounded-md border border-jank-control bg-jank-surface px-2 text-label-13"
            onInput={(event) => {
              setFilter(event.currentTarget.value);
              setPage(0);
            }}
          />
          {counters.length > 20 && (
            <div class="flex items-center justify-between gap-2 text-label-12">
              <Button compact onPress={() => setPage(Math.max(0, page - 1))}>
                Previous counters
              </Button>
              <span>
                {page + 1}/{Math.ceil(counters.length / 20)}
              </span>
              <Button
                compact
                onPress={() => setPage(Math.min(Math.ceil(counters.length / 20) - 1, page + 1))}
              >
                Next counters
              </Button>
            </div>
          )}
          <dl class="divide-y divide-jank-divider">
            {counters.slice(page * 20, (page + 1) * 20).map((counter) => {
              const sample = readCounter(model, counter, at);
              const formatted = formatCounter(counter.key, sample.value ?? null);
              const pinned = pins.includes(counter.id);
              const delta =
                sample.delta === null
                  ? sample.changed === null
                    ? "Δ unavailable"
                    : sample.changed
                      ? "Changed"
                      : "Unchanged"
                  : sample.delta === 0
                    ? "Δ ±0"
                    : `Δ ${sample.delta > 0 ? "+" : ""}${formatCounter(counter.key, sample.delta).text}`;
              return (
                <div key={counter.id} class="py-2" data-counter-id={counter.id}>
                  <dt
                    class="flex items-center justify-between gap-2 text-label-12"
                    title={`${counter.system} · ${counter.key}`}
                  >
                    <span class="min-w-0 truncate">
                      {formatted.label}{" "}
                      <span class="text-jank-text-secondary">· {counter.systemLabel}</span>
                    </span>
                    {counter.numeric && onPin && (
                      <button
                        type="button"
                        aria-label={`${pinned ? "Unpin" : "Pin"} ${counter.systemLabel} ${counter.key}`}
                        aria-pressed={pinned}
                        aria-describedby={hint}
                        disabled={!pinned && pins.length >= MAX_PINNED_COUNTERS}
                        class="focus-ring shrink-0 rounded-xs text-jank-focus underline disabled:text-jank-text-disabled"
                        onClick={() => onPin(counter.id)}
                      >
                        {pinned ? "Unpin" : "Pin"}
                      </button>
                    )}
                  </dt>
                  <dd class="mt-1 font-mono text-label-13 wrap-anywhere" title={sample.reason}>
                    {sample.value === undefined ? "Not recorded" : formatted.text}
                  </dd>
                  <dd class="text-label-12 text-jank-text-secondary">
                    {delta} · {sample.age === null ? sample.reason : `${formatMs(sample.age)} old`}
                  </dd>
                </div>
              );
            })}
          </dl>
          {!counters.length && <p class="text-copy-13">No matching counters.</p>}
        </>
      ) : (
        <p class="text-copy-13 text-jank-text-secondary">No counter history or catalog supplied.</p>
      )}
    </section>
  );
}
