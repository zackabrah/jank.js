import { formatNumber } from "./format.ts";
import type { Measurement, MissingMeasurementState } from "./measurement.ts";

const labels: Record<MissingMeasurementState, string> = {
  "not-observed": "not observed",
  pending: "pending",
  unknown: "unknown",
  unsupported: "n/a",
  disabled: "off",
  "no-gpu-record": "no GPU record",
  evicted: "evicted",
  "not-recorded": "not recorded",
  rejected: "rejected",
  error: "error",
};

export function MeasurementValue({
  measurement,
  precision = 1,
  compact = false,
}: {
  measurement: Measurement;
  precision?: number;
  compact?: boolean;
}) {
  if (measurement.status === "measured") return formatNumber(measurement.value, precision);
  const label = labels[measurement.status];
  if (compact)
    return (
      <span data-state={measurement.status} title={measurement.reason}>
        <span aria-hidden="true">—</span>
        <span class="sr-only">
          {label}: {measurement.reason}
        </span>
      </span>
    );
  return (
    <span
      data-state={measurement.status}
      title={measurement.reason}
      class="inline-flex h-4.5 items-center whitespace-nowrap rounded-full border border-dashed border-jank-control px-1.5 align-middle font-sans text-label-12 font-normal text-jank-text-secondary data-[state=not-observed]:border-solid data-[state=not-observed]:border-jank-divider data-[state=pending]:border-dotted data-[state=rejected]:border-solid data-[state=rejected]:border-red-400 data-[state=rejected]:bg-red-100 data-[state=rejected]:text-jank-error data-[state=error]:border-solid data-[state=error]:border-red-400 data-[state=error]:bg-red-100 data-[state=error]:text-jank-error"
    >
      {label}
      <span class="sr-only">: {measurement.reason}</span>
    </span>
  );
}
