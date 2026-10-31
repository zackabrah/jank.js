import type {
  Comparison,
  ComparisonMetric,
  ComparisonSnapshot,
  ComparisonTrial,
} from "../comparison/comparison.ts";
import { serializeComparison } from "../comparison/recordings.ts";
import { gpuCoverageText } from "./capture-description.ts";
import { element } from "./dom.ts";

export function createComparisonView(
  root: HTMLElement,
  comparison: Comparison,
  actions: { changed: () => void; saveJson: (json: string, filename: string) => void },
) {
  const section = element<HTMLElement>(root, "[data-comparison]");
  section.hidden = false;
  const { changed, saveJson } = actions;
  const locked = new Map<HTMLButtonElement, boolean>();
  let renderedTrials = -1;
  let renderedStatus = "";
  function render(): void {
    const snapshot = comparison.snapshot();
    const active = snapshot.status === "running";
    renderControls(section, snapshot);
    const status = element<HTMLElement>(section, "[data-comparison-status]");
    const text = active
      ? `Running pair ${snapshot.pair}/${snapshot.options.pairs} · ${snapshot.variant} · ${snapshot.stage} · ${snapshot.targetFps} FPS budget`
      : snapshot.reason;
    if (status.textContent !== text) {
      status.textContent = text;
    }
    lockControls(active);
    if (snapshot.trials.length !== renderedTrials || snapshot.status !== renderedStatus) {
      renderedTrials = snapshot.trials.length;
      renderedStatus = snapshot.status;
      renderResults(section, snapshot);
    }
  }
  function lockControls(active: boolean): void {
    if (!active) {
      for (const [button, disabled] of locked) {
        button.disabled = disabled;
      }
      locked.clear();
      return;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
      if (
        ![
          "record",
          "arm",
          "auto-toggle",
          "inspect-trigger",
          "disarm",
          "budget",
          "budget-preset",
          "trace",
          "gpu",
          "export",
          "export-capture",
          "open-viewer",
          "open-capture",
        ].includes(button.dataset.action ?? "")
      ) {
        continue;
      }
      if (!locked.has(button)) {
        locked.set(button, button.disabled);
      }
      button.disabled = true;
    }
  }
  function action(name: string): void {
    if (name === "comparison-start") {
      const fields = element<HTMLFieldSetElement>(section, "fieldset");
      const invalid = fields.querySelector<HTMLInputElement>("input:invalid");
      if (invalid) {
        invalid.reportValidity();
        return;
      }
      const read = (key: string) =>
        element<HTMLInputElement>(section, `[data-comparison-input="${key}"]`).valueAsNumber;
      comparison.start({
        pairs: read("pairs"),
        warmupMs: read("warmup") * 1000,
        measureMs: read("measure") * 1000,
      });
      element<HTMLButtonElement>(section, '[data-action="comparison-stop"]').disabled = false;
      element<HTMLButtonElement>(section, '[data-action="comparison-stop"]').focus();
    } else if (name === "comparison-stop") {
      comparison.cancel();
    } else if (name === "comparison-export") {
      const report = comparison.report();
      if (report && report.status !== "running") {
        saveJson(serializeComparison(report), "jank-ab-comparison.json");
      }
    }
    changed();
  }
  const visibility = () => {
    if (root.ownerDocument.hidden) {
      comparison.cancel("Tab hidden; restart in the foreground.");
      changed();
    }
  };
  root.ownerDocument.addEventListener("visibilitychange", visibility);
  return {
    render,
    action,
    dispose: () => {
      comparison.cancel("Panel closed; comparison cancelled.");
      root.ownerDocument.removeEventListener("visibilitychange", visibility);
      locked.clear();
    },
  };
}
function renderControls(section: HTMLElement, snapshot: ComparisonSnapshot): void {
  const active = snapshot.status === "running";
  const stop = element<HTMLButtonElement>(section, '[data-action="comparison-stop"]');
  const save = element<HTMLButtonElement>(section, '[data-action="comparison-export"]');
  const focusExport = !active && section.ownerDocument.activeElement === stop;
  element<HTMLFieldSetElement>(section, "fieldset").disabled = active;
  element<HTMLButtonElement>(section, '[data-action="comparison-start"]').disabled = active;
  stop.disabled = !active;
  save.disabled = active || snapshot.status === "idle";
  if (focusExport) {
    save.focus({ preventScroll: true });
  }
}
const ms = (value: number) => `${value.toFixed(2)} ms`;
const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
function renderMetric(label: string, metric: ComparisonMetric | null): string {
  if (!metric) {
    return `${label} comparison: unknown — all paired trials need sufficient coverage and comparable measurements.`;
  }
  const { median, p95, overBudget } = metric;
  return `${label} median: A ${ms(median.a)}, B ${ms(median.b)}; paired B − A ${ms(median.deltaMs)}. p95: A ${ms(p95.a)}, B ${ms(p95.b)}; paired B − A ${ms(p95.deltaMs)} (${p95.deltaPercent?.toFixed(1) ?? "unknown"}%). Paired p95 range ${p95.pairedRange.map(ms).join(" to ")}. Over budget: A ${overBudget.a.toFixed(1)}%, B ${overBudget.b.toFixed(1)}% (${overBudget.deltaPoints.toFixed(1)} percentage points).`;
}
function renderResults(section: HTMLElement, snapshot: ComparisonSnapshot): void {
  const document = section.ownerDocument;
  const summary = element<HTMLElement>(section, "[data-comparison-summary]");
  summary.replaceChildren();
  for (const key of ["cpu", "gpu", "frame"] as const) {
    const paragraph = document.createElement("p");
    paragraph.className = "jank-note";
    paragraph.textContent = renderMetric(key.toUpperCase(), snapshot.summary[key]);
    summary.append(paragraph);
  }
  const list = element<HTMLElement>(section, "[data-comparison-trials]");
  list.replaceChildren();
  for (const trial of snapshot.trials) {
    const details = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = `Pair ${trial.pair} / ${trial.variant} · ${trial.frames} frames · ${percent(trial.windowCoverage)} window`;
    const text = document.createElement("p");
    text.className = "jank-note";
    text.textContent = trialDescription(trial);
    details.append(title, text);
    list.append(details);
  }
}
function trialDescription(trial: Omit<ComparisonTrial, "recording">): string {
  const context = trial.context;
  const resolution = context.resolution
    ? `${context.resolution.widthPx} × ${context.resolution.heightPx} px`
    : "unknown resolution";
  const settings = context.settings
    .map((setting) => `${setting.label}: ${setting.value}`)
    .join("; ");
  const timings = (["cpu", "gpu", "frame"] as const)
    .map((key) => {
      const metric = trial[key];
      return `${key.toUpperCase()}: ${metric ? `median ${ms(metric.medianMs)}, p95 ${ms(metric.p95Ms)}, ${metric.overBudgetPercent.toFixed(1)}% over budget` : "unknown"}`;
    })
    .join(". ");
  return `${context.label} · ${resolution} · ${context.animation}. ${settings}. ${timings}. CPU coverage ${percent(trial.cpuCoverage)}; GPU coverage ${percent(trial.gpuCoverage)} (${trial.gpuMeasurement ?? "unknown measurement"}). ${gpuCoverageText(trial.intervalCoverage)} Finalization: ${trial.finalization}. Recording truncated: ${trial.truncated ? "yes" : "no"}.`;
}
