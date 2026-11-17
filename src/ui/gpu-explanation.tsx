import { NBSP } from "../format.ts";
import { type GpuFrame, gpuFrameCoverage } from "../gpu/model.ts";
import { DisclosureSection } from "./disclosure-section.tsx";

export function GpuExplanation({ frame }: { frame: GpuFrame }) {
  const coverage = gpuFrameCoverage(frame);
  return (
    <DisclosureSection title="Why this coverage?" summary={coverage.completeness}>
      <div class="space-y-2 py-2 text-label-12 text-jank-text-secondary wrap-anywhere">
        <p>
          {coverage.expected === 0
            ? "Complete empty frame: the host reports no submitted GPU invocations."
            : coverage.expected === null
              ? "Unknown inventory: the host has not declared every submitted invocation. Timed results alone cannot establish complete coverage."
              : `Host-declared invocations: ${coverage.expected} · valid timings: ${coverage.timed}.`}
        </p>
        <p>
          {coverage.pending} pending · {coverage.rejected} rejected · {coverage.omitted} omitted
        </p>
        <dl>
          {(["render", "compute"] as const).map((kind) => {
            const passes = frame.invocations.filter((pass) => pass.kind === kind);
            return (
              <div key={kind} class="flex justify-between gap-2">
                <dt>{kind === "render" ? "Render" : "Compute"}</dt>
                <dd class="font-mono">
                  {passes.filter((pass) => pass.state === "timed").length}/{passes.length} timed
                </dd>
              </div>
            );
          })}
        </dl>
        <p>Counts by kind cover retained invocation records only.</p>
        {frame.omitted > 0 && (
          <p>
            {frame.omitted} additional invocations omitted beyond record capacity; their kinds and
            individual reasons were not retained.
          </p>
        )}
        {frame.invocations.some((pass) => pass.state !== "timed") && (
          <ul class="m-0 list-none space-y-1 p-0">
            {frame.invocations
              .filter((pass) => pass.state !== "timed")
              .map((pass) => (
                <li key={pass.id}>
                  {pass.label} · {pass.kind} · {pass.state}:{" "}
                  {pass.reason ?? "Awaiting GPU readback"}
                </li>
              ))}
          </ul>
        )}
        {frame.invocations.some((pass) => pass.milliseconds === 0) && (
          <p>
            A timed 0{NBSP}ms result is valid and may be below timer resolution; it is not missing.
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
