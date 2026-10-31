import type { GpuCoverage } from "../analysis/gpu-coverage.ts";

/** The same interval-coverage wording is used for live capture, archive and exported files. */
export function gpuCoverageText(coverage: GpuCoverage): string {
  const percent =
    coverage.coveragePercent === null ? "—" : `${coverage.coveragePercent.toFixed(1)}%`;
  const reasons = coverage.reasons.map((entry) => `${entry.reason}: ${entry.frames}`).join("; ");
  return `GPU interval coverage ${percent} (${coverage.completeFrames}/${coverage.totalFrames} complete). ${coverage.incompleteFrames} incomplete; ${coverage.sampledFrames} deliberately skipped; ${coverage.missingFrames} without interval evidence.${reasons ? ` ${reasons}.` : ""}`;
}
