import type { AutomaticCapture } from "../capture/controller.ts";
import { withUnit } from "../format.ts";
import { gpuFrameCoverage } from "../gpu/model.ts";
import { MeasurementValue } from "../measurement-value.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { GpuExplanation } from "../ui/gpu-explanation.tsx";
import { EventList } from "./event-list.tsx";
import { FrameChart } from "./frame-chart.tsx";
import { MetricRow } from "./metric-row.tsx";
import { type LiveView, unknown } from "./model.ts";
export function LiveDetails({
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
  const gpu = view.gpu;
  const gpuSummary = gpu
    ? `${gpu.timed ?? "?"}/${gpu.expected ?? "?"} timed · ${gpu.completeness}`
    : "No timing source";
  const evidence = gpu?.evidence;
  const coverage = evidence ? gpuFrameCoverage(evidence) : null;
  const cpuSummary = `${view.cpu.length} scopes · ${view.complete} complete frames`;
  return (
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <FrameChart
        view={view}
        frozen={frozen}
        recordingAfterFrame={recordingAfterFrame}
        automatic={automatic}
      />
      <div class="px-3">
        <DisclosureSection title="CPU scopes" summary={cpuSummary} defaultOpen>
          <p class="py-1 font-mono text-label-12 text-jank-text-secondary">
            ms / frame · 0 to budget
          </p>
          {view.cpu.map((row) => (
            <MetricRow
              key={row.id}
              label={row.label}
              duration={row.duration}
              budget={view.budget}
            />
          ))}
          <MetricRow
            label="Unattributed"
            detail="wait + untracked"
            duration={view.unattributed}
            budget={view.budget}
          />
          <p class="py-2 text-label-12 text-jank-text-secondary">
            Avg of {view.complete} complete frames · {view.excluded} excluded
          </p>
        </DisclosureSection>
        <DisclosureSection title="GPU passes" summary={gpuSummary} defaultOpen>
          {gpu ? (
            <>
              <p class="py-1 font-mono text-label-12 text-jank-text-secondary">
                {gpu.timed ?? "Unknown"} of {gpu.expected ?? "unknown"} expected timed ·{" "}
                {gpu.completeness}
              </p>
              <p class="py-1 text-label-12 text-jank-text-secondary">ms / GPU sample</p>
              {gpu.status !== "ready" && (
                <p class="py-1 text-label-12 text-jank-text-secondary">
                  Timing source: {gpu.status}
                </p>
              )}
              <MetricRow
                label="Timed GPU work"
                detail={gpu.completeness === "complete" ? "pass sum" : "partial / unknown scope"}
                duration={gpu.timedWork ?? unknown("No timed pass sum supplied")}
                precision={1}
                budget={view.budget}
              />
              {coverage && (
                <p class="py-1 text-label-12 text-jank-text-secondary">
                  {coverage.pending} pending · {coverage.rejected} rejected · {coverage.omitted}{" "}
                  omitted
                  {coverage.expected === 0 && " · none submitted"}
                </p>
              )}
              {evidence && (
                <p class="py-1 text-label-12 text-jank-text-secondary">
                  GPU clock · {evidence.source} · resolution{" "}
                  {evidence.resolutionMs === null
                    ? "unknown"
                    : withUnit(evidence.resolutionMs, "ms")}
                  . Pass sum can double-count overlapping work.
                </p>
              )}
              {gpu.passes.map((pass) => (
                <MetricRow
                  key={pass.id}
                  label={pass.label}
                  detail={pass.kind === "unknown" ? "" : pass.kind}
                  precision={1}
                  duration={pass.duration}
                  budget={view.budget}
                />
              ))}
              <MetricRow
                label="First-to-last span"
                precision={1}
                duration={gpu.span}
                budget={view.budget}
              />
              <p class="py-2 text-label-12 text-jank-text-secondary">
                Sample {gpu.sampleFrame ?? "unknown"} · age {gpu.ageFrames ?? "unknown"} frames
                {gpu.dropped > 0 && ` · ${gpu.dropped} dropped source frames (not invocations)`}
              </p>
              {evidence ? (
                <GpuExplanation frame={evidence} />
              ) : (
                <p class="py-2 text-label-12 text-jank-text-secondary">
                  No invocation evidence supplied. Coverage and rejection causes cannot be verified
                  from this summary.
                </p>
              )}
            </>
          ) : (
            <div class="py-3 text-copy-13 text-jank-text-secondary">
              <MeasurementValue
                measurement={unknown("The host has not connected a GPU timestamp source")}
              />
              <p class="mt-2">Connect a renderer timing source to inspect GPU passes.</p>
            </div>
          )}
        </DisclosureSection>
        <DisclosureSection
          title="Counters"
          summary={`${view.counters.reduce((count, group) => count + group.values.length, 0)} reported`}
        >
          {!view.counters.length && (
            <p class="py-2 text-label-12 text-jank-text-secondary">No counters supplied.</p>
          )}
          {view.counters.map((group) => (
            <section key={group.id} class="pb-2">
              <h3 class="m-0 py-1 font-mono text-label-12 font-normal text-jank-text-secondary">
                {group.label}
              </h3>
              <dl aria-label={`${group.label} counters`}>
                {group.values.map((counter) => (
                  <div
                    key={counter.name}
                    class="flex min-h-7 items-center justify-between gap-3 py-1 text-label-13"
                  >
                    <dt class="min-w-0 flex-1 wrap-anywhere" title={counter.name}>
                      {counter.label}
                    </dt>
                    <dd class="min-w-0 max-w-1/2 wrap-anywhere text-right font-mono tabular-nums">
                      {counter.text}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DisclosureSection>
        <EventList events={view.events} />
      </div>
    </div>
  );
}
