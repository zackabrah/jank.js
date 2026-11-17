import { formatMs, NBSP, withUnit } from "../format.ts";
import { gpuFrameToLive } from "../gpu/model.ts";
import { unknown } from "../live/model.ts";
import { MeasurementValue } from "../measurement-value.tsx";
import type { DiagnosticFrame, PerformanceRecording } from "../recording/types.ts";
import { GpuExplanation } from "../ui/gpu-explanation.tsx";
import { CounterDetails } from "./counter-details.tsx";
import { FrameEvidence } from "./frame-evidence.tsx";
import type { RecordingInspection } from "./inspection.ts";
import { type CounterModel, largestScopeChange } from "./inspector-model.ts";
import type { recordingLanes } from "./lanes.ts";

export function FrameDetails({
  recording,
  frame,
  index,
  lanes,
  medians,
  summary,
  counters,
  pins,
  onPin,
  label = "Selected frame details",
  clock = "",
}: {
  recording: PerformanceRecording;
  frame: DiagnosticFrame;
  index: number;
  lanes: ReturnType<typeof recordingLanes>;
  medians: Map<string, number>;
  summary: RecordingInspection;
  counters: CounterModel;
  /** Omitted where counters already have lanes, as in the comparison viewer. */
  pins?: string[] | undefined;
  onPin?: ((id: string) => void) | undefined;
  label?: string;
  /** Names the clock where "At" could be mistaken for another time on screen. */
  clock?: string;
}) {
  const gpu = recording.gpu?.samples.findLast((sample) => sample.diagnosticFrame === frame.id);
  const evidence = recording.gpuTiming?.frames.find((sample) => sample.frameId === frame.id);
  const timing = evidence ? gpuFrameToLive(evidence, frame.id) : null;
  const change = largestScopeChange(lanes, medians, index);
  const spike = summary.spikes.find((spike) => spike.index === index);
  const scopes = lanes.cpu
    .flatMap((lane) => {
      const cell = lane.values.get(index);
      return cell?.value !== null && cell?.value !== undefined
        ? [{ lane, cell, value: cell.value }]
        : [];
    })
    .sort((a, b) => b.value - a.value);
  return (
    <section aria-label={label} class="space-y-3 bg-jank-surface p-4 wrap-anywhere">
      <h2 class="m-0 text-heading-16">
        Frame f{frame.id} · <span class="font-mono">{formatMs(frame.interval, 2)}</span>
      </h2>
      <p class="font-mono text-label-13 text-jank-text-secondary">
        {(frame.interval / recording.budget.frameMs).toFixed(1)}× budget
        {spike ? ` · ▲${spike.rank} of ${summary.spikes.length} spikes` : ""}
      </p>
      <p class="text-copy-13 text-jank-text-secondary">
        At {withUnit((frame.at / 1000).toFixed(3), "s")}
        {clock} · CPU scopes {frame.coverage === "unavailable" ? "not recorded" : frame.coverage}.{" "}
        {frame.droppedScopes > 0 ? `${frame.droppedScopes} scopes dropped.` : ""}
      </p>
      <section
        aria-label="CPU change heuristic"
        class="rounded-md border border-jank-divider p-3 text-label-12"
      >
        <h3 class="m-0 text-label-12 text-jank-text-secondary">
          Largest change vs median CPU scope · heuristic
        </h3>
        <p class="mt-1">
          {change
            ? `${change.label} · +${formatMs(change.delta, 2)} (median ${formatMs(change.median, 2)})`
            : "No positive change with complete evidence."}
        </p>
        <p class="mt-1 text-jank-text-secondary">
          Compared with complete frames in this recording. Association, not a cause.
        </p>
      </section>
      {scopes.length > 0 ? (
        <table class="w-full text-left text-copy-13">
          <thead class="text-jank-text-secondary">
            <tr>
              <th scope="col" class="py-2 font-medium">
                CPU scope
              </th>
              <th scope="col" class="py-2 text-right font-medium">
                Time · frame share
              </th>
            </tr>
          </thead>
          <tbody>
            {scopes.slice(0, 64).map(({ lane, value, cell }) => (
              <tr key={lane.id} class="border-t border-jank-divider">
                <th scope="row" class="py-2 font-normal">
                  <span title={lane.description}>
                    {lane.label}
                    {cell.status === "partial" ? "*" : ""}
                  </span>
                </th>
                <td class="py-2 text-right font-mono">
                  {formatMs(value, 2)}{" "}
                  <span class="block text-label-12 text-jank-text-secondary">
                    {((value / frame.interval) * 100).toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="text-copy-13">
          {frame.coverage === "complete"
            ? "No CPU scopes observed in this frame."
            : "CPU scope timings are unavailable for this frame."}
        </p>
      )}
      {frame.scopes.length > 0 && (
        <p class="text-label-12 text-jank-text-secondary">
          Matching scope intervals are merged; different scopes can overlap, so shares need not sum
          to 100%. * Retained scopes only, coverage incomplete.
        </p>
      )}
      {scopes.length > 64 && (
        <p class="text-label-12">
          Showing the 64 largest scope groups. Evidence and Copy frame JSON retain the original
          records.
        </p>
      )}
      <dl class="space-y-1 text-label-12">
        {lanes.context.map((lane) => {
          const cell = lane.values.get(index);
          return (
            <div key={lane.id} class="flex justify-between gap-2" title={lane.description}>
              <dt>{lane.label}</dt>
              <dd class="font-mono">
                {cell?.value === null || cell?.value === undefined
                  ? "Unknown"
                  : formatMs(cell.value, 2)}
              </dd>
            </div>
          );
        })}
      </dl>
      {timing ? (
        <section
          data-gpu-evidence={frame.id}
          aria-label="Selected frame GPU evidence"
          tabIndex={-1}
          class="focus-ring space-y-2 text-copy-13"
        >
          <p>
            GPU busy: <MeasurementValue measurement={timing.busy} />
          </p>
          <p>
            Timed GPU work:{" "}
            <MeasurementValue
              measurement={timing.timedWork ?? unknown("No timed pass sum supplied")}
            />
            {NBSP}ms · {timing.timed}/{timing.expected ?? "?"} invocations timed ·{" "}
            {timing.completeness}
          </p>
          <p>
            Instrumented span: <MeasurementValue measurement={timing.span} />
            {NBSP}ms
          </p>
          <ul class="m-0 list-none space-y-1 p-0">
            {timing.passes.map((pass) => (
              <li key={pass.id}>
                {pass.label} · {pass.kind}: <MeasurementValue measurement={pass.duration} />
                {pass.duration.status === "measured" ? `${NBSP}ms` : ` · ${pass.duration.reason}`}
              </li>
            ))}
          </ul>
          <p class="text-label-12 text-jank-text-secondary">
            GPU clock, separate from CPU time. Timed work is a pass sum and may include overlaps; it
            is not device utilization. Resolution:{" "}
            {evidence?.resolutionMs === null ? "unknown" : `${evidence?.resolutionMs}${NBSP}ms`}.
          </p>
          {evidence && <GpuExplanation frame={evidence} />}
        </section>
      ) : (
        <>
          <p class="text-copy-13">
            GPU span:{" "}
            {gpu?.status === "ready" && gpu.gpuMilliseconds !== null
              ? formatMs(gpu.gpuMilliseconds, 2)
              : "Unknown"}
            . GPU completeness: unknown.
          </p>
          <p class="text-label-12 text-jank-text-secondary">
            {gpu
              ? "Matched by explicit diagnostic frame ID. Span includes gaps and is not GPU busy time."
              : "No GPU record explicitly linked to this frame; renderer frame IDs are not treated as matches."}
          </p>
        </>
      )}
      <CounterDetails model={counters} at={frame.at - frame.interval} pins={pins} onPin={onPin} />
      <FrameEvidence recording={recording} frame={frame} />
    </section>
  );
}
