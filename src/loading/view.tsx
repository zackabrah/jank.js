import { useId, useState } from "preact/hooks";
import { Notice } from "../ui/notice.tsx";
import { LoadingCache, LoadingWaterfall } from "./details.tsx";
import type { LoadingView } from "./model.ts";
import { cacheSummary, coldComparison, loadingTime as time } from "./timing.ts";

const kinds = {
  "fresh-context": "Cold · fresh context",
  "repeat-session": "Warm · repeat",
  editor: "Editor",
};
const states = {
  loading: { label: "In progress", glyph: "◐", style: "bg-gray-200 text-jank-text" },
  ready: { label: "Ready", glyph: "✓", style: "bg-green-200 text-jank-live" },
  failed: { label: "Failed", glyph: "✕", style: "bg-red-100 text-jank-error" },
  cancelled: { label: "Cancelled", glyph: "—", style: "bg-gray-200 text-jank-text-secondary" },
};

export function LoadingTab({ model, frozen }: { model: LoadingView | null; frozen: boolean }) {
  const id = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const retained = model?.sessions.find((session) => session.id === selected);
  const session = retained ?? model?.latest;
  const status = session ? states[session.status] : null;
  const comparison = session && model ? coldComparison(session, model) : null;
  const cache = session ? cacheSummary(session) : null;
  return (
    <div class="relative h-full space-y-3 overflow-y-auto overscroll-contain p-3 text-copy-13">
      {session && <h2 class="m-0 text-heading-14">Loading</h2>}
      {frozen && (
        <p class="text-label-12 text-jank-frozen">
          Showing a frozen loading snapshot. Host activity continues.
        </p>
      )}
      {!session || !model || !status ? (
        <Notice>
          {model
            ? "No load sessions yet. A session appears when the host reports scene loading."
            : "No loading source connected. The host must report its loading sessions to this panel."}
        </Notice>
      ) : (
        <>
          <div class="space-y-2">
            <label for={id} class="block text-label-12 text-jank-text-secondary">
              Session
            </label>
            <select
              id={id}
              value={retained ? String(retained.id) : ""}
              onChange={(event) =>
                setSelected(event.currentTarget.value ? Number(event.currentTarget.value) : null)
              }
              class="focus-ring h-8 w-full min-w-0 rounded-md border border-jank-control bg-jank-surface px-2 text-label-13"
            >
              <option value="">Latest session · {model.latest?.id}</option>
              {model.sessions.toReversed().map((run) => (
                <option key={run.id} value={run.id}>
                  Session {run.id} · {kinds[run.kind]}
                </option>
              ))}
            </select>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span
                role="status"
                aria-label={`Loading session ${status.label.toLowerCase()}`}
                class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-12 ${status.style}`}
              >
                <span aria-hidden="true">{status.glyph}</span>
                {status.label}
              </span>
              <span class="text-label-12 text-jank-text-secondary">{kinds[session.kind]}</span>
            </div>
            <p class="wrap-anywhere">{session.label || `Session ${session.id}`}</p>
          </div>
          <dl
            aria-label="Loading summary"
            class="grid grid-cols-3 gap-3 wrap-anywhere border-y border-jank-divider py-3"
          >
            <div>
              <dt class="text-label-12 text-jank-text-secondary">Wall time</dt>
              <dd class="mt-1 font-mono text-label-13">{time(session.elapsedMs)}</dd>
              <dd class="text-label-12 text-jank-text-secondary">
                {session.status === "loading"
                  ? "so far"
                  : session.status === "failed"
                    ? "until failure"
                    : session.status === "cancelled"
                      ? "until cancelled"
                      : `${session.total} ops`}
              </dd>
            </div>
            <div>
              <dt class="text-label-12 text-jank-text-secondary">
                {session.status === "failed"
                  ? "Failed ops"
                  : comparison?.delta != null
                    ? "vs cold"
                    : "Cold run"}
              </dt>
              <dd class="mt-1 font-mono text-label-13">
                {session.status === "failed"
                  ? `${session.failed} / ${session.total}`
                  : comparison?.delta != null
                    ? `${comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : ""}${time(Math.abs(comparison.delta))}`
                    : comparison?.cold
                      ? time(comparison.cold.elapsedMs)
                      : session.kind === "fresh-context"
                        ? "Reference"
                        : "Unknown"}
              </dd>
              <dd class="text-label-12 text-jank-text-secondary">
                {session.status === "failed"
                  ? `${session.cancelled} cancelled`
                  : comparison?.cold
                    ? comparison.percent !== null
                      ? `${comparison.percent > 0 ? "+" : comparison.percent < 0 ? "−" : ""}${Math.abs(comparison.percent).toFixed(0)}% of ${time(comparison.cold.elapsedMs)}`
                      : `session ${comparison.cold.id}`
                    : session.kind === "fresh-context"
                      ? "fresh context"
                      : "no matching run"}
              </dd>
            </div>
            <div>
              <dt class="text-label-12 text-jank-text-secondary">Cache hits</dt>
              <dd class="mt-1 font-mono text-label-13">
                {cache?.percent != null ? `${cache.percent.toFixed(0)}%` : cache ? "—" : "Unknown"}
              </dd>
              <dd class="text-label-12 text-jank-text-secondary">
                {cache
                  ? cache.total
                    ? `${cache.hits} / ${cache.total}`
                    : "no lookups"
                  : "not reported"}
              </dd>
            </div>
          </dl>
          {session.status === "failed" && (
            <Notice tone="error">
              Load failed{session.elapsedMs === null ? "" : ` after ${time(session.elapsedMs)}`}.{" "}
              {session.failed} of {session.total} reported operations failed.
              {session.failures.length > 0 && (
                <p class="mt-1 wrap-anywhere">{session.failures.join(" · ")}</p>
              )}
              <p class="mt-1 wrap-anywhere">
                {session.failure || "The host did not supply a failure reason."}
              </p>
            </Notice>
          )}
          {session.status === "cancelled" && (
            <Notice>Session cancelled. Retained outcomes stop at the host's cutoff.</Notice>
          )}
          {session.status === "ready" &&
            (session.pending > 0 || session.failed > 0 || session.cancelled > 0) && (
              <Notice tone="warning">
                The host marked this session ready with incomplete or unsuccessful operations.
                Review the outcomes below.
              </Notice>
            )}
          <LoadingWaterfall session={session} cold={comparison?.cold ?? null} />
          <LoadingCache session={session} />
          <section aria-label="Loading outcomes" class="space-y-2">
            <h3 class="m-0 text-label-13 font-medium">Operation outcomes</h3>
            <dl class="space-y-1 text-label-12">
              {[
                ["Completed", session.completed],
                ["Failed", session.failed],
                ["Cancelled", session.cancelled],
                [
                  session.status === "loading" ? "Running" : "Unfinished at cutoff",
                  session.pending,
                ],
              ].map(([label, value]) => (
                <div key={label} class="flex justify-between gap-2">
                  <dt>{label}</dt>
                  <dd class="font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            <p class="text-label-12 text-jank-text-secondary">
              Counts describe reported operations, not total loading progress. Wall time is the
              session's elapsed time; overlapping operation times are not added together.
            </p>
          </section>
          <section
            aria-label="Loading session history"
            class="space-y-2 border-t border-jank-divider pt-3"
          >
            <h3 class="m-0 text-label-13 font-medium">Sessions</h3>
            <ul class="m-0 list-none divide-y divide-jank-divider p-0">
              {model.sessions.toReversed().map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    aria-pressed={session.id === run.id}
                    onClick={() => setSelected(run.id)}
                    class="focus-ring flex w-full items-start justify-between gap-2 rounded-xs py-2 text-left text-label-12 hover:bg-gray-alpha-100 aria-pressed:bg-gray-alpha-100"
                  >
                    <span>
                      Session {run.id} · {kinds[run.kind]}
                      <span class="block text-jank-text-secondary">{states[run.status].label}</span>
                    </span>
                    <span class="shrink-0 font-mono">
                      {time(run.elapsedMs)}
                      {run.status === "loading" && " +"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p class="text-label-12 text-jank-text-secondary">
              Latest eight finished sessions plus current, supplied by the host.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
