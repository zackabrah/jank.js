import { useMemo } from "preact/hooks";
import { resultValue, Variant } from "../compare/results-view.tsx";
import { formatMs, withUnit } from "../format.ts";
import { formatCounter } from "../live/counters.ts";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { comparisonFramePair } from "./comparison-frame-pair.ts";
import type { comparisonFrames } from "./comparison-frames.ts";
import type { ComparisonLane, comparisonLanes } from "./comparison-lanes.ts";
import { FrameDetails } from "./frame-details.tsx";
import { inspectRecording } from "./inspection.ts";
import { scopeMedians } from "./inspector-model.ts";

const MAX_ROWS = 64;
const groups = [
  ["cpu", "CPU scopes", "ms · CPU clock", "No CPU scopes observed in these frames."],
  ["gpu", "GPU passes", "ms · GPU clock", "No GPU passes timed in these frames."],
  ["context", "Frame context", "ms · can overlap scopes", "No frame context retained."],
  ["counter", "Counters", "at frame start", "No numeric counters supplied."],
] as const;
const seconds = (at: number) => withUnit((at / 1000).toFixed(3), "s");

type Row = ReturnType<typeof comparisonFramePair>["rows"][number];

function format(lane: ComparisonLane, value: number) {
  return lane.group === "counter"
    ? formatCounter(lane.counter.key, value).text
    : resultValue(value);
}
function formatDelta(lane: ComparisonLane, delta: number) {
  if (lane.group !== "counter") return resultValue(delta, true);
  const text = formatCounter(lane.counter.key, Math.abs(delta)).text;
  return delta === 0 ? text : `${delta < 0 ? "−" : "+"}${text}`;
}

function Cell({ lane, cell }: { lane: ComparisonLane; cell: Row["a"] }) {
  return (
    <td class="px-1 py-1.5 font-mono tabular-nums wrap-anywhere" title={cell.reason}>
      {cell.value === null ? (
        <>
          <span class="text-jank-text-secondary">{cell.status}</span>
          <span class="sr-only">. {cell.reason}</span>
        </>
      ) : (
        `${format(lane, cell.value)}${cell.status === "partial" ? "*" : ""}`
      )}
      {lane.group === "counter" && (
        <span class="block font-sans text-jank-text-secondary">
          {cell.age == null ? "No sample" : `${formatMs(cell.age)} old`}
        </span>
      )}
    </td>
  );
}

function PairedRows({
  title,
  scale,
  empty,
  rows,
}: {
  title: string;
  scale: string;
  empty: string;
  rows: Row[];
}) {
  return (
    <section aria-label={`Paired ${title}`} class="space-y-1">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="m-0 text-heading-14">{title}</h3>
        <span class="text-label-12 text-jank-text-secondary">{scale}</span>
      </div>
      {rows.length ? (
        <table class="w-full table-fixed border-collapse text-right text-label-12">
          <colgroup>
            <col class="w-[40%]" />
            <col class="w-1/5" />
            <col class="w-1/5" />
            <col class="w-1/5" />
          </colgroup>
          <thead class="text-jank-text-secondary">
            <tr class="border-b border-jank-divider">
              <th scope="col" class="py-1.5 pl-1 text-left font-normal">
                <span class="sr-only">{title}</span>
              </th>
              {["A", "B", "B − A"].map((name) => (
                <th key={name} scope="col" class="px-1 py-1.5 font-normal">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map(({ lane, a, b, delta }) => (
              <tr
                key={lane.id}
                data-comparison-frame-row={lane.id}
                class="border-b border-jank-divider align-top"
              >
                <th scope="row" class="py-1.5 pl-1 text-left font-normal wrap-anywhere">
                  <span title={lane.description}>
                    {lane.group === "counter"
                      ? formatCounter(lane.counter.key, null).label
                      : lane.label}
                  </span>
                  {lane.group !== "context" && (
                    <span class="block text-jank-text-secondary">
                      {lane.group === "counter"
                        ? lane.counter.systemLabel
                        : lane.description.split(" · ")[0]}
                    </span>
                  )}
                </th>
                <Cell lane={lane} cell={a} />
                <Cell lane={lane} cell={b} />
                <td class="px-1 py-1.5 font-mono tabular-nums wrap-anywhere">
                  {delta === null ? "—" : formatDelta(lane, delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="text-label-12 text-jank-text-secondary">{empty}</p>
      )}
      {rows.length > MAX_ROWS && (
        <p class="text-label-12 text-jank-text-secondary">
          Showing the {MAX_ROWS} largest differences of {rows.length}.
        </p>
      )}
    </section>
  );
}

/** The frames under the shared cursor, read side by side, then each one in full. */
export function ComparisonFrame({
  lanes,
  chart,
  at,
  budgetMs,
  overLimit,
}: {
  lanes: ReturnType<typeof comparisonLanes>;
  chart: ReturnType<typeof comparisonFrames>;
  at: number;
  budgetMs: number;
  overLimit: number;
}) {
  const pair = comparisonFramePair(lanes, chart, at);
  const inspected = useMemo(
    () =>
      lanes.sources.map(({ recording, timing }) =>
        recording && timing
          ? { summary: inspectRecording(recording), medians: scopeMedians(recording, timing) }
          : null,
      ),
    [lanes],
  );
  const sides = [pair.a, pair.b];
  return (
    <section aria-label="Paired frames" class="space-y-4 text-copy-13">
      <div>
        <h2 class="m-0 text-heading-16">
          Frame at <span class="font-mono">{seconds(at)}</span>
        </h2>
        <p class="text-label-12 text-jank-text-secondary">since each variant's measurement start</p>
      </div>
      <dl class="m-0 space-y-2">
        {sides.map(({ key, frame, reason }) => (
          <div key={key} data-comparison-frame-variant={key} class="flex items-start gap-2">
            <dt>
              <Variant name={key} />
              <span class="sr-only"> frame</span>
            </dt>
            {frame ? (
              <dd class="m-0 min-w-0">
                <p
                  data-over={frame.value > overLimit ? "" : undefined}
                  class="font-mono text-label-13 data-over:text-jank-over"
                >
                  f{frame.id} · {formatMs(frame.value, 2)}
                </p>
                <p class="text-label-12 text-jank-text-secondary">
                  {(frame.value / budgetMs).toFixed(1)}× budget · {seconds(frame.start)}–
                  {seconds(frame.end)}
                </p>
              </dd>
            ) : (
              <dd class="m-0 min-w-0 text-label-12 text-jank-text-secondary">{reason}</dd>
            )}
          </div>
        ))}
      </dl>
      {pair.delta !== null && (
        <p data-comparison-frame-delta="" class="font-mono text-label-13">
          B − A {withUnit(resultValue(pair.delta, true), "ms")}
        </p>
      )}
      <p class="text-label-12 text-jank-text-secondary">
        These frames overlap this time in separate runs. They are not matched work, and their IDs
        and boundaries differ. Differences describe these two frames only.
      </p>
      {groups.map(([group, title, scale, empty]) => (
        <PairedRows
          key={group}
          title={title}
          scale={scale}
          empty={empty}
          rows={pair.rows.filter((row) => row.lane.group === group)}
        />
      ))}
      <p class="text-label-12 text-jank-text-secondary">
        Largest difference first. Differences need measured values on both sides. * Retained partial
        CPU data. Scopes and context lanes can overlap, so they do not add up.
      </p>
      <div>
        {sides.map(({ key, frame }, index) => {
          const source = lanes.sources[index];
          const detail = inspected[index];
          const record = frame && source?.recording?.frames[frame.index];
          return (
            frame &&
            record &&
            source?.recording &&
            source.timing &&
            source.counters &&
            detail && (
              <DisclosureSection
                key={key}
                title={`Variant ${key} · f${frame.id}`}
                summary="Full details and evidence"
              >
                <div class="-mx-4">
                  <FrameDetails
                    label={`Variant ${key} frame details`}
                    clock=" on this trial's clock"
                    recording={source.recording}
                    frame={record}
                    index={frame.index}
                    lanes={source.timing}
                    medians={detail.medians}
                    summary={detail.summary}
                    counters={source.counters}
                  />
                </div>
              </DisclosureSection>
            )
          );
        })}
      </div>
    </section>
  );
}
