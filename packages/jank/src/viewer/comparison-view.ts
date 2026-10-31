import type {
  ComparisonDifference,
  ComparisonReport,
  ComparisonTrial,
} from "../comparison/comparison.ts";
import { element, milliseconds, percent, renderTable, write } from "./dom.ts";

function variation(metric: ComparisonDifference): string {
  const [low, high] = metric.pairedRange;
  const range = `${milliseconds(low)} to ${milliseconds(high)}`;
  if (low < 0 && high > 0) {
    return `Mixed results — ${range} crosses zero`;
  }
  if (low === 0 && high === 0) {
    return `No observed difference — ${range}`;
  }
  return `${range}${low === 0 || high === 0 ? " (includes zero)" : ""}`;
}
export function renderComparison(root: HTMLElement, report: ComparisonReport): void {
  write(
    root,
    "experiment",
    `${report.status.toUpperCase()} · ${report.options.pairs} pairs · ${report.options.warmupMs / 1000} s warm-up + ${report.options.measureMs / 1000} s measurement · ${report.targetFps} FPS (${milliseconds(1000 / report.targetFps)} budget). ${report.reason}`,
  );
  const mixed = (["cpu", "gpu", "frame"] as const).filter((key) => {
    const range = report.summary[key]?.p95.pairedRange;
    return range && range[0] < 0 && range[1] > 0;
  });
  const notice = element<HTMLElement>(root, "[data-viewer-mixed]");
  notice.hidden = mixed.length === 0;
  notice.textContent = `Mixed results: ${mixed.map((key) => key.toUpperCase()).join(", ")} p95 differences cross zero. Inspect the individual pairs before treating the change as an improvement.`;
  const rows: string[][] = [];
  for (const key of ["cpu", "gpu", "frame"] as const) {
    const metric = report.summary[key];
    const name = key === "frame" ? "Frame pacing" : key.toUpperCase();
    if (!metric) {
      rows.push([
        name,
        "Unknown",
        "Unknown",
        "Unknown",
        "Incomplete pairs, insufficient coverage or incompatible GPU measurements",
      ]);
      continue;
    }
    for (const [label, value] of [
      ["median", metric.median],
      ["p95", metric.p95],
    ] as const) {
      rows.push([
        `${name} ${label}`,
        milliseconds(value.a),
        milliseconds(value.b),
        `${milliseconds(value.deltaMs)} (${value.deltaPercent?.toFixed(1) ?? "unknown"}%)`,
        variation(value),
      ]);
    }
    rows.push([
      `${name} over budget`,
      `${metric.overBudget.a.toFixed(1)}%`,
      `${metric.overBudget.b.toFixed(1)}%`,
      `${metric.overBudget.deltaPoints.toFixed(1)} percentage points`,
      "Median of per-trial percentages",
    ]);
  }
  renderTable(
    element(root, "[data-viewer-results]"),
    "A/B results",
    ["Metric", "A", "B", "Paired B − A", "Variation"],
    rows,
  );
  renderTable(
    element(root, "[data-viewer-trials]"),
    "Trial evidence",
    [
      "Trial",
      "Frames / window",
      "CPU samples",
      "GPU samples",
      "GPU interval coverage",
      "Finalization / losses",
    ],
    report.trials.map((trial) => [
      `${trial.pair} / ${trial.variant}`,
      `${trial.frames} / ${percent(trial.windowCoverage)}`,
      percent(trial.cpuCoverage),
      `${percent(trial.gpuCoverage)} · ${trial.gpuMeasurement ?? "unknown"}`,
      trial.intervalCoverage.coveragePercent === null
        ? "Unknown"
        : `${trial.intervalCoverage.coveragePercent.toFixed(1)}%`,
      `${trial.finalization}${trial.truncated ? "; truncated recording" : ""}; ${trial.intervalCoverage.missingFrames} missing, ${trial.intervalCoverage.incompleteFrames} incomplete, ${trial.intervalCoverage.sampledFrames} sampled out. ${trial.intervalCoverage.reasons.map((item) => `${item.reason}: ${item.frames}`).join("; ")}`,
    ]),
  );
  const select = element<HTMLSelectElement>(root, "[data-viewer-trial]");
  select.replaceChildren(
    ...report.trials.map((trial, index) => {
      const option = root.ownerDocument.createElement("option");
      option.value = String(index);
      option.textContent = `Pair ${trial.pair} / ${trial.variant} — ${trial.context.label}`;
      return option;
    }),
  );
  select.disabled = report.trials.length === 0;
}
function contextEntries(
  trial: ComparisonTrial | undefined,
): Map<string, { label: string; value: string | null }> {
  const result = new Map<string, { label: string; value: string | null }>();
  if (!trial) {
    return result;
  }
  const context = trial.context;
  result.set("label", { label: "Scene label", value: context.label });
  result.set("resolution", {
    label: "Drawing resolution",
    value: context.resolution
      ? `${context.resolution.widthPx} × ${context.resolution.heightPx} px`
      : null,
  });
  result.set("animation", { label: "Animation", value: context.animation });
  const counts = new Map<string, number>();
  for (const setting of context.settings) {
    const occurrence = (counts.get(setting.label) ?? 0) + 1;
    counts.set(setting.label, occurrence);
    result.set(JSON.stringify([setting.label, occurrence]), {
      label: setting.label,
      value: JSON.stringify(setting.value),
    });
  }
  return result;
}
export function renderSettings(root: HTMLElement, report: ComparisonReport, index: number): void {
  const pair = report.trials[index]?.pair ?? 1;
  const a = contextEntries(
    report.trials.find((trial) => trial.pair === pair && trial.variant === "A"),
  );
  const b = contextEntries(
    report.trials.find((trial) => trial.pair === pair && trial.variant === "B"),
  );
  const entries = new Map([...a, ...b]);
  write(
    root,
    "settings-note",
    `Pair ${pair}: actual settings captured for each trial. Missing values are not assumed equal.`,
  );
  renderTable(
    element(root, "[data-viewer-settings]"),
    "Scene settings",
    ["Setting", "A", "B", "Comparison"],
    [...entries].map(([key, entry]) => {
      const left = a.get(key);
      const right = b.get(key);
      let comparison = "Unknown";
      if (!left || !right) {
        comparison = "Missing from one trial";
      } else if (left.value !== null && right.value !== null) {
        comparison = left.value === right.value ? "Same" : "Different";
      }
      return [
        entry.label,
        left ? (left.value ?? "Unknown") : "Not recorded",
        right ? (right.value ?? "Unknown") : "Not recorded",
        comparison,
      ];
    }),
  );
}
