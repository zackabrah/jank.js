import { withUnit } from "../format.ts";
import { formatCounter } from "../live/counters.ts";
import type { LoadingSessionView } from "./model.ts";
import { loadingTime, stageTiming } from "./timing.ts";

const intervalsText = (intervals: readonly { start: number; end: number }[]) =>
  intervals
    .slice(0, 128)
    .map(({ start, end }) => `${loadingTime(start)} to ${loadingTime(end)}`)
    .join(", ") || "none drawn";

export function LoadingWaterfall({
  session,
  cold,
}: {
  session: LoadingSessionView;
  cold: LoadingSessionView | null;
}) {
  const names = [
    ...new Set([...session.stages, ...(cold?.stages ?? [])].map((stage) => stage.stage)),
  ];
  const rows = names.map((name) => {
    const stage = session.stages.find((item) => item.stage === name);
    const reference = cold?.stages.find((item) => item.stage === name);
    return {
      name,
      stage,
      timing: stage ? stageTiming(stage, session.elapsedMs) : null,
      reference: reference && cold ? stageTiming(reference, cold.elapsedMs) : null,
    };
  });
  let extent = Math.max(session.elapsedMs ?? 0, cold?.elapsedMs ?? 0, 1);
  for (const row of rows)
    for (const interval of [...(row.timing?.all ?? []), ...(row.reference?.all ?? [])])
      extent = Math.max(extent, interval.end);
  const step = 10 ** Math.floor(Math.log10(extent));
  const rounded = Math.ceil(extent / step) * step;
  const axis = Number.isFinite(rounded) ? rounded : extent;
  const position = (ms: number) => `${(ms / axis) * 100}%`;
  return (
    <section aria-label="Stages waterfall" class="space-y-2">
      <h3 class="m-0 text-label-13 font-medium">Stages</h3>
      <p class="text-label-12 text-jank-text-secondary">
        Solid: ended · striped: {session.status === "loading" ? "running" : "unfinished at cutoff"}
        {cold && ` · dashed: cold session ${cold.id}`} · ✕ failed
      </p>
      <div
        aria-hidden="true"
        class="relative ml-24.5 h-4 font-mono text-label-12 text-jank-text-secondary"
      >
        <span class="absolute left-0">0</span>
        <span class="absolute left-1/2 -translate-x-1/2">{axis / 2}</span>
        <span class="absolute right-0">{withUnit(axis, "ms")}</span>
      </div>
      {rows.length === 0 && (
        <p class="text-label-12 text-jank-text-secondary">No stages reported.</p>
      )}
      {rows.map(({ name, stage, timing, reference }) => (
        <div key={name} class="space-y-1">
          <div class="grid grid-cols-[5.625rem_minmax(0,1fr)] items-center gap-2">
            <span class="wrap-anywhere text-label-12">{name}</span>
            <div
              role="img"
              aria-label={`${name}, axis 0 to ${axis} ms. ${timing ? `${stage?.count} operations; ${timing.missing} without drawable timing. Ended: ${intervalsText(timing.finished)}. ${session.status === "loading" ? "Running" : "Unfinished"}: ${intervalsText(timing.running)}.` : "Stage not reported."}${reference ? ` Cold: ${intervalsText(reference.all)}.` : ""}`}
              class="relative h-7 border-x border-jank-divider bg-gray-alpha-100"
            >
              {reference?.all.slice(0, 128).map(({ start, end }) => (
                <span
                  key={`cold-${start}`}
                  data-loading-cold
                  class="absolute top-0.5 h-6 rounded-xs border border-dashed border-jank-text-secondary"
                  style={{ left: position(start), width: position(end - start), minWidth: 1 }}
                />
              ))}
              {timing?.finished.slice(0, 128).map(({ start, end }) => (
                <span
                  key={`done-${start}`}
                  data-loading-ended
                  class="absolute top-1.5 h-4 rounded-xs bg-jank-text/70"
                  style={{ left: position(start), width: position(end - start), minWidth: 1 }}
                />
              ))}
              {timing?.running.slice(0, 128).map(({ start, end }) => (
                <span
                  key={`running-${start}`}
                  data-loading-running
                  class="absolute top-1.5 h-4 rounded-xs border border-jank-text bg-jank-surface"
                  style={{
                    left: position(start),
                    width: position(end - start),
                    minWidth: 1,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, var(--jank-text) 0px, var(--jank-text) 2px, transparent 2px, transparent 5px)",
                  }}
                />
              ))}
              {session.elapsedMs !== null && (
                <span
                  data-loading-cutoff
                  class="absolute inset-y-0 border-l border-jank-frozen"
                  style={{ left: position(session.elapsedMs) }}
                />
              )}
              {timing?.failures.slice(0, 128).map((operation) => (
                <span
                  key={operation.id}
                  data-loading-failure
                  class="absolute top-1 -translate-x-1/2 bg-jank-surface font-mono text-label-13 text-jank-error"
                  style={{ left: position(operation.endMs ?? 0) }}
                >
                  ✕
                </span>
              ))}
            </div>
          </div>
          <p class="text-label-12 text-jank-text-secondary">
            {timing
              ? `${loadingTime(timing.wallMs)} active wall · ${stage?.count} ops · ${loadingTime(timing.totalMs)} op time`
              : "Stage not reported in this session."}
          </p>
          {timing && timing.missing > 0 && (
            <p class="text-label-12 text-jank-text-secondary">
              Timing unavailable for {timing.missing} of {stage?.count} operations.
            </p>
          )}
          {stage?.compileProgress && (
            <p class="text-label-12 text-jank-text-secondary">
              {stage.compileProgress.completed} of {stage.compileProgress.total} compilation work
              items finished.
            </p>
          )}
          {!!reference?.missing && (
            <p class="text-label-12 text-jank-text-secondary">
              Cold timing incomplete; only known intervals outlined.
            </p>
          )}
          {!!timing?.failures.length && (
            <p class="wrap-anywhere text-label-12 text-jank-error">
              Failed at{" "}
              {timing.failures
                .slice(0, 128)
                .map((operation) => loadingTime(operation.endMs))
                .join(", ")}
              .
            </p>
          )}
          {[
            timing?.finished.length,
            timing?.running.length,
            timing?.failures.length,
            reference?.all.length,
          ].some((length) => (length ?? 0) > 128) && (
            <p class="text-label-12 text-jank-text-secondary">
              First 128 intervals/markers per series shown; totals include all observations.
            </p>
          )}
        </div>
      ))}
      <p class="text-label-12 text-jank-text-secondary">
        {session.elapsedMs === null
          ? "Current-time marker unavailable."
          : `${session.status === "loading" ? "Now" : "Cutoff"}: ${loadingTime(session.elapsedMs)}.`}{" "}
        Active wall counts overlaps once; op time sums durations (not CPU/GPU time).
      </p>
    </section>
  );
}

export function LoadingCache({ session }: { session: LoadingSessionView }) {
  return (
    <section aria-label="Loading cache" class="space-y-2 border-t border-jank-divider pt-3">
      <h3 class="m-0 text-label-13 font-medium">Cache</h3>
      {!session.stages.length ? (
        <p class="text-label-12 text-jank-text-secondary">Cache data unavailable.</p>
      ) : (
        <table class="w-full table-fixed text-label-12">
          <caption class="sr-only">Cache outcomes and received bytes per stage</caption>
          <thead class="text-jank-text-secondary">
            <tr>
              <th scope="col" class="w-1/4 py-1 text-left font-normal">
                Stage
              </th>
              <th scope="col" class="text-right font-normal">
                Hit
              </th>
              <th scope="col" class="text-right font-normal">
                Miss
              </th>
              <th scope="col" class="text-right font-normal">
                Shared
              </th>
              <th scope="col" class="w-1/4 text-right font-normal">
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {session.stages.map((stage) => (
              <tr key={stage.stage} class="border-t border-jank-divider">
                <th scope="row" class="wrap-anywhere py-2 pr-1 text-left font-normal">
                  {stage.stage}
                </th>
                {(["cacheHits", "cacheMisses", "cacheInflight", "bytes"] as const).map((key) => (
                  <td key={key} class="wrap-anywhere pl-1 text-right font-mono">
                    {stage[key] === null ? (
                      <span role="img" aria-label="Not reported" title="Not reported">
                        —
                      </span>
                    ) : key === "bytes" ? (
                      formatCounter("receivedBytes", stage[key]).text
                    ) : (
                      stage[key]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="text-label-12 text-jank-text-secondary">
        Shared: reused in-flight request. Received: response-body bytes, including browser cache;
        not network traffic or cache size. — Not reported.
      </p>
    </section>
  );
}
