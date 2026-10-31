import type { HeadroomPhase, HeadroomReport, HeadroomStep } from "./headroom-run.ts";

export function loadLabel(phase: HeadroomPhase, amount: number): string {
  if (phase === "cpu") {
    return `${amount.toLocaleString()} × 4,096 CPU updates/frame`;
  }
  if (phase === "gpu") {
    return `${amount} shader iterations/pixel`;
  }
  return `${amount.toLocaleString()} cubes`;
}

function milliseconds(value: number | null): string {
  return value === null ? "unknown" : `${value.toFixed(2)} ms`;
}

export function recommendedLevel(
  steps: readonly HeadroomStep[],
  budgetMs: number,
): HeadroomStep | undefined {
  return steps.findLast(
    (step) =>
      step.verdict === "within-budget" &&
      step.cpuP95Ms !== null &&
      step.cpuP95Ms <= budgetMs * 0.8 &&
      step.gpuP95Ms !== null &&
      step.gpuP95Ms <= budgetMs * 0.8,
  );
}

export function phaseSummary(report: HeadroomReport, phase: "cpu" | "gpu" | "scene"): string {
  const steps = report.steps.filter((step) => step.phase === phase);
  const passed = steps.findLast((step) => step.verdict === "within-budget");
  const recommended = recommendedLevel(steps, report.budgetMs);
  const last = steps.at(-1);
  const lines = [
    passed
      ? `Last within measured budgets: ${loadLabel(phase, passed.amount)}.`
      : "No passing level measured.",
  ];
  if (passed) {
    lines.push(
      `p95 CPU ${milliseconds(passed.cpuP95Ms)}, GPU ${milliseconds(passed.gpuP95Ms)}; GPU coverage ${Math.round(passed.gpuCoverage * 100)}%.`,
    );
  }
  if (passed?.gpuP95Ms === null) {
    lines.push("GPU unverified.");
  }
  lines.push(
    recommended
      ? `20% spare: ${loadLabel(phase, recommended.amount)}.`
      : "No level verified with 20% spare on both CPU and GPU.",
  );
  if (last && last.verdict !== "within-budget") {
    lines.push(
      `Next: ${loadLabel(phase, last.amount)} — ${last.verdict}${last.limiting.length ? ` (${last.limiting.join(", ")})` : ""}.`,
    );
  }
  if (last?.verdict === "unmeasured") {
    lines.push("Too few frames or valid GPU samples to establish a limit.");
  }
  if (last?.verdict === "guard") {
    lines.push("Stopped this ramp after three severe frames.");
  }
  const end = report.phaseEnds[phase];
  if (end === "load cap reached") {
    lines.push("Load cap reached; this is a lower bound, not the ceiling.");
  } else if (!last) {
    lines.push(end ?? (report.status === "running" ? "Not measured yet." : "Not measured."));
  }
  return lines.join(" ");
}

export function baselineSummary(report: HeadroomReport): string {
  const first = report.steps[0];
  if (!first) {
    return report.status === "running"
      ? "Baseline: warming up and measuring…"
      : "Baseline: not measured.";
  }
  const remaining = (timeMs: number | null) =>
    milliseconds(timeMs === null ? null : Math.max(0, report.budgetMs - timeMs));
  return `Baseline ${first.verdict}${first.limiting.length ? ` (${first.limiting.join(", ")})` : ""}. p95: CPU ${milliseconds(first.cpuP95Ms)}, GPU ${milliseconds(first.gpuP95Ms)}. Remaining: CPU ${remaining(first.cpuP95Ms)}, GPU ${remaining(first.gpuP95Ms)}. GPU coverage ${Math.round(first.gpuCoverage * 100)}%.`;
}
