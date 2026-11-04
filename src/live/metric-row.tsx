import type { Measurement } from "../measurement.ts";
import { MeasurementValue } from "../measurement-value.tsx";

export function MetricRow({
  label,
  detail,
  duration,
  budget,
  overLimit,
  precision = 2,
}: {
  label: string;
  detail?: string;
  duration: Measurement;
  budget: number;
  overLimit: number;
  precision?: number;
}) {
  const value = duration.status === "measured" ? duration.value : null;
  return (
    <div class="relative flex min-h-7 items-center justify-between gap-3 py-1 text-label-13">
      {value !== null && (
        <span
          aria-hidden="true"
          class={`pointer-events-none absolute inset-y-0 left-0 ${value > overLimit ? "bg-jank-over-band" : "bg-jank-fill-hover"}`}
          style={{ width: `${Math.min(1, value / budget) * 100}%` }}
        />
      )}
      <span class="relative min-w-0 truncate" title={label}>
        {label}
        {detail && <span class="ml-1 text-label-12 text-jank-text-secondary">{detail}</span>}
      </span>
      <span class="relative shrink-0 font-mono tabular-nums">
        <MeasurementValue measurement={duration} precision={precision} />
      </span>
    </div>
  );
}
