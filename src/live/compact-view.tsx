import type { AutomaticCapture } from "../capture/controller.ts";
import { formatSeconds, NBSP } from "../format.ts";
import type { Measurement } from "../measurement.ts";
import { MeasurementValue } from "../measurement-value.tsx";
import { FrameChart } from "./frame-chart.tsx";
import type { LiveView } from "./model.ts";

function Metric({
  value,
  label,
  precision = 1,
  over = false,
  large = false,
}: {
  value: Measurement;
  label: string;
  precision?: number;
  over?: boolean;
  large?: boolean;
}) {
  return (
    <div
      data-metric={label}
      data-over={over ? "" : undefined}
      class={`shrink-0 whitespace-nowrap font-mono tabular-nums data-over:text-jank-over ${large ? "text-label-20 font-semibold" : "text-label-12"}`}
    >
      <dt class="sr-only">
        {label === "p95"
          ? "p95 frame milliseconds"
          : label === "fps"
            ? "Frames per second"
            : "Percent over budget"}
      </dt>
      <dd>
        <MeasurementValue measurement={value} precision={precision} compact />
        <span
          aria-hidden="true"
          class="font-sans text-label-12 font-normal text-jank-text-secondary"
        >
          {label.startsWith("%") ? "" : NBSP}
          {label}
        </span>
      </dd>
    </div>
  );
}

export function CompactMetrics({
  view,
  mini = false,
  share = true,
}: {
  view: LiveView;
  mini?: boolean;
  share?: boolean;
}) {
  return (
    <dl class="flex shrink-0 items-baseline gap-2" aria-label="Live frame statistics">
      <Metric
        value={view.p95}
        label="p95"
        large={mini}
        over={view.p95.status === "measured" && view.p95.value > view.overLimit}
      />
      <Metric value={view.fps} label="fps" precision={0} />
      {share && <Metric value={view.over} label="% over" precision={0} />}
    </dl>
  );
}

export function MiniContent({
  view,
  frozen,
  recordingAfterFrame,
  automatic,
}: {
  view: LiveView;
  frozen: boolean;
  recordingAfterFrame?: number | null | undefined;
  automatic?: AutomaticCapture | null | undefined;
}) {
  const top = view.cpu.reduce<LiveView["cpu"][number] | null>(
    (best, row) =>
      row.duration.status === "measured" &&
      (best?.duration.status !== "measured" || row.duration.value > best.duration.value)
        ? row
        : best,
    null,
  );
  return (
    <>
      <div class="px-2.5 pt-2">
        <CompactMetrics view={view} mini />
      </div>
      <FrameChart
        view={view}
        compact
        frozen={frozen}
        recordingAfterFrame={recordingAfterFrame}
        automatic={automatic}
      />
      <div class="flex items-baseline justify-between gap-3 px-2.5 pb-2 text-label-12 text-jank-text-secondary">
        <span
          class="shrink-0 whitespace-nowrap"
          title={
            view.worstAge === null
              ? "No frame samples"
              : `${formatSeconds(view.worstAge)} ago · f${view.worstFrame}`
          }
        >
          worst{" "}
          <span class="font-mono text-jank-text">
            <MeasurementValue measurement={view.worst} compact />
          </span>
        </span>
        <span
          class="flex min-w-0 items-baseline gap-1"
          title={top?.label ?? "No observed CPU scopes"}
        >
          top{" "}
          {top ? (
            <>
              <span class="min-w-0 truncate">{top.label}</span>{" "}
              <span class="shrink-0 font-mono text-jank-text">
                <MeasurementValue measurement={top.duration} precision={2} />
              </span>
            </>
          ) : (
            "unknown"
          )}
        </span>
      </div>
    </>
  );
}
