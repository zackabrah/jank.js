import { type GpuCoverage, gpuInventoryUnknown } from "../gpu/model.ts";

/** Counts refer to explicit frame records, never an inferred pass inventory. */
export function GpuCoverageBar({
  coverage,
  label = "GPU frame coverage",
  compact = false,
}: {
  coverage: GpuCoverage;
  label?: string;
  compact?: boolean;
}) {
  const inventoryUnknown = gpuInventoryUnknown(coverage);
  const description = `${coverage.complete} complete · ${coverage.partial} partial · ${coverage.unknown} unknown · ${coverage.missing} missing GPU frame records`;
  return (
    <div class="space-y-1 py-2 text-label-12 text-jank-text-secondary">
      <div class="flex flex-wrap justify-between gap-1">
        <p>
          {label} · {coverage.total} {coverage.total === 1 ? "frame" : "frames"}
        </p>
        <span class="font-mono">
          {inventoryUnknown
            ? "Unknown inventory"
            : coverage.total
              ? `${(Math.floor((coverage.complete * 1000) / coverage.total) / 10).toFixed(1)}% complete`
              : "No frames yet"}
        </span>
      </div>
      <div
        role="img"
        aria-label={description}
        title={description}
        class="flex h-1.5 overflow-hidden rounded-full border border-jank-divider bg-jank-surface"
      >
        {(
          [
            ["complete", "bg-jank-text"],
            ["partial", "bg-jank-text-secondary"],
            ["unknown", "bg-jank-control"],
            ["missing", "bg-coverage-missing"],
          ] as const
        ).map(([kind, className]) => (
          <span
            key={kind}
            class={className}
            style={{ width: `${coverage.total ? (coverage[kind] * 100) / coverage.total : 0}%` }}
          />
        ))}
      </div>
      {compact ? (
        <p>
          {inventoryUnknown
            ? "The host did not declare every submitted invocation."
            : `${coverage.complete.toLocaleString()} / ${coverage.total.toLocaleString()} complete frames`}
        </p>
      ) : (
        <dl class="space-y-1">
          {(
            [
              [
                "complete",
                "Complete",
                "Every submitted invocation is timed; includes explicit empty frames.",
                "bg-jank-text",
              ],
              [
                "partial",
                "Incomplete",
                "Pending, rejected or omitted invocations.",
                "bg-jank-text-secondary",
              ],
              [
                "unknown",
                "Unknown inventory",
                "The host did not declare every submitted invocation.",
                "bg-jank-control",
              ],
              [
                "missing",
                "No GPU record",
                "No record was retained for these frames; the cause is unavailable.",
                "bg-coverage-missing",
              ],
            ] as const
          ).map(([kind, text, reason, className]) => (
            <div key={kind} class="flex justify-between gap-2" title={reason}>
              <dt class="flex items-center gap-1.5">
                <span aria-hidden="true" class={`size-2 shrink-0 rounded-xs ${className}`} />
                {text}
                <span class="sr-only"> · {reason}</span>
              </dt>
              <dd class="font-mono">{coverage[kind].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      {coverage.pending > 0 && (
        <p>
          {coverage.pending} {coverage.pending === 1 ? "invocation" : "invocations"} awaiting GPU
          readback.
        </p>
      )}
    </div>
  );
}
