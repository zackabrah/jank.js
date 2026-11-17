import type { comparisonDifference } from "./comparison-difference.ts";
import { ComparisonHatch } from "./comparison-hatch.tsx";
import { type ComparisonRange, comparisonWindow } from "./comparison-range.ts";
import { ComparisonTrack } from "./comparison-track.tsx";

export function ComparisonDifference({
  model,
  label,
  format,
  duration,
  range,
  at,
  onSelect,
  onHover,
}: {
  model: ReturnType<typeof comparisonDifference>;
  label: string;
  format: (value: number) => string;
  duration: number;
  range: ComparisonRange;
  at: number;
  onSelect: (at: number) => void;
  onHover: (at: number | null) => void;
}) {
  const window = comparisonWindow(range, duration);
  const index = model.points.findIndex(
    (point) => at >= point.start && (at < point.end || (at === duration && point.end === at)),
  );
  const cell = model.values[index];
  const value = cell?.value ?? null;
  const text =
    value === null
      ? "unavailable"
      : `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
  const reason = cell?.reason ?? "Both variants need a recorded frame at this elapsed time.";
  return (
    <div
      data-comparison-difference={label}
      class="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 border-b border-jank-divider py-2"
    >
      <span class="text-right text-label-12">B − A</span>
      <div class="mb-1 flex min-w-0 justify-between gap-2 text-label-12">
        <span
          class="truncate text-jank-text-secondary"
          title={model.known ? `Symmetric range: ±${format(model.extent)}` : undefined}
        >
          {model.known ? `±${format(model.extent)} · zero centred` : "Range unavailable"}
        </span>
        <span
          data-comparison-difference-readout=""
          class="max-w-40 truncate font-mono"
          title={`${text}. ${reason}`}
        >
          {text}
        </span>
      </div>
      <span aria-hidden="true" class="text-right font-mono text-label-12 text-jank-text-secondary">
        0
      </span>
      <ComparisonTrack
        range={range}
        at={at}
        onSelect={onSelect}
        onHover={onHover}
        label={`${label} B minus A difference`}
        readout={`${text}. ${reason}`}
        className="h-14"
      >
        <ComparisonHatch
          path={model.geometry.missing}
          series="difference"
          range={range}
          duration={duration}
        />
        <svg
          aria-hidden="true"
          data-comparison-window=""
          viewBox={window.viewBox}
          preserveAspectRatio="none"
          class="pointer-events-none block size-full"
        >
          <path
            d="M0 50H100"
            stroke-dasharray="3 3"
            class="stroke-jank-text-secondary"
            vector-effect="non-scaling-stroke"
          />
          <path
            data-comparison-difference-series=""
            d={model.geometry.path}
            fill="none"
            stroke-width="1.5"
            class="stroke-jank-text"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        {value !== null && (
          <span
            aria-hidden="true"
            class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jank-text"
            style={{ left: `${window.position(at)}%`, top: `${model.geometry.y(value)}%` }}
          />
        )}
      </ComparisonTrack>
    </div>
  );
}
