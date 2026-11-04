import { formatMs, formatSeconds, NBSP } from "../format.ts";
import type { Measurement } from "../measurement.ts";
import { MeasurementValue } from "../measurement-value.tsx";
import type { LiveView } from "./model.ts";

function Kpi({
  label,
  value,
  detail,
  suffix = "",
  precision = 1,
  over = false,
}: {
  label: string;
  value: Measurement;
  detail: string;
  suffix?: string;
  precision?: number;
  over?: boolean;
}) {
  return (
    <div data-metric={label} class="min-w-0 bg-jank-surface px-2 py-2">
      <dt class="truncate text-label-12 text-jank-text-secondary">{label}</dt>
      <dd
        data-value
        class="mt-0.5 whitespace-nowrap font-mono text-label-20 font-semibold tabular-nums data-over:text-jank-over"
        data-over={over ? "" : undefined}
      >
        <MeasurementValue measurement={value} precision={precision} />
        {value.status === "measured" && suffix && (
          <span class="font-sans text-label-12 font-normal text-jank-text-secondary">{suffix}</span>
        )}
      </dd>
      <dd class="truncate text-label-12 text-jank-text-secondary" title={detail}>
        {detail}
      </dd>
    </div>
  );
}

export function FullMetrics({ view }: { view: LiveView }) {
  return (
    <dl
      class="grid grid-cols-4 gap-px border-b border-jank-divider bg-jank-divider"
      aria-label="Live frame statistics"
    >
      <Kpi
        label="p95 frame"
        value={view.p95}
        suffix={`${NBSP}ms`}
        over={view.p95.status === "measured" && view.p95.value > view.overLimit}
        detail={
          view.p95.status === "measured" && view.p95.value > view.overLimit
            ? `▲ over ${view.budget.toFixed(1)}`
            : "frame interval"
        }
      />
      <Kpi
        label="FPS"
        value={view.fps}
        precision={0}
        detail={
          view.average.status === "measured" ? `avg ${formatMs(view.average.value)}` : "warming up"
        }
      />
      <Kpi
        label="Over budget"
        value={view.over}
        suffix="%"
        precision={0}
        detail={view.frames.length ? `${view.overCount} / ${view.frames.length}` : "no samples"}
      />
      <Kpi
        label="Worst"
        suffix={`${NBSP}ms`}
        value={view.worst}
        over={view.worst.status === "measured" && view.worst.value > view.overLimit}
        detail={
          view.worstAge === null
            ? "no samples"
            : `${formatSeconds(view.worstAge)} ago · f${view.worstFrame}`
        }
      />
    </dl>
  );
}
