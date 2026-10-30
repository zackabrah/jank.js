import { summarizeFrames } from "../analysis/statistics.ts";
import { drawFrameChart } from "../charts/frame-chart.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import type { Profiler } from "../profiler.ts";
import type { CaptureOptions, SavedCapture } from "../recordings/capture.ts";
import { element, milliseconds, rows, write } from "./dom.ts";

export function initializeCapture(root: HTMLElement, profiler: Profiler): void {
  for (const [key, value] of Object.entries(profiler.capture.getOptions())) {
    element<HTMLInputElement>(root, `[data-input="${key}"]`).value = String(value);
  }
  element<HTMLInputElement>(root, '[data-input="fps"]').value = String(
    profiler.snapshot().targetFps,
  );
}

export function readCaptureOptions(root: HTMLElement): CaptureOptions {
  return {
    thresholdMs: element<HTMLInputElement>(root, '[data-input="thresholdMs"]').valueAsNumber,
    beforeFrames: element<HTMLInputElement>(root, '[data-input="beforeFrames"]').valueAsNumber,
    afterFrames: element<HTMLInputElement>(root, '[data-input="afterFrames"]').valueAsNumber,
    cooldownMs: element<HTMLInputElement>(root, '[data-input="cooldownMs"]').valueAsNumber,
  };
}

export function renderCaptureProgress(
  root: HTMLElement,
  profiler: Profiler,
  snapshot: ProfilerSnapshot,
): void {
  const progress = profiler.capture.getProgress();
  const health = element<HTMLElement>(root, '[data-value="capture-health"]');
  health.hidden = progress.kind === "recent";
  const coverage = coverageText(progress.gpu);
  write(root, "capture-health", `${coverage} · ${progress.remainingFrames} frames remaining`);
  write(
    root,
    "capture-progress",
    `${progress.kind.toUpperCase()} · ${progress.frameCount} sealed frames. ${coverage}`,
  );
  write(
    root,
    "capture-capacity",
    `${progress.remainingFrames} frames remaining. GPU retention pool: ${snapshot.gpuCapacity.remainingPasses} pass records and ${snapshot.gpuCapacity.remainingSamples} sample slots remaining. At capacity, oldest details are evicted.`,
  );
}

function coverageText(coverage: GpuCoverage): string {
  const percent =
    coverage.coveragePercent === null ? "—" : `${coverage.coveragePercent.toFixed(1)}%`;
  const reasons = coverage.reasons.map((entry) => `${entry.reason}: ${entry.frames}`).join("; ");
  return `GPU interval coverage ${percent} (${coverage.completeFrames}/${coverage.totalFrames} complete). ${coverage.incompleteFrames} incomplete; ${coverage.sampledFrames} deliberately skipped; ${coverage.missingFrames} without interval evidence.${reasons ? ` ${reasons}.` : ""}`;
}

/** Cache only DOM for retained IDs; full recordings are read once when adding a thumbnail. */
export function createCaptureView(
  root: HTMLElement,
  profiler: Profiler,
): (snapshot: ProfilerSnapshot) => void {
  const list = element<HTMLElement>(root, "[data-captures]");
  const entries = new Map<number, HTMLElement>();
  return (snapshot) => {
    const captures = profiler.capture.list();
    for (const [id, node] of entries) {
      if (!captures.some((capture) => capture.id === id)) {
        node.remove();
        entries.delete(id);
      }
    }
    for (const capture of captures) {
      if (entries.has(capture.id)) {
        continue;
      }
      entries.set(capture.id, appendCapture(list, profiler, capture));
    }
    write(
      root,
      "capture-empty",
      captures.length === 0
        ? "No completed captures."
        : "Captures stay available after closing this panel.",
    );
    write(root, "capture-state", profiler.capture.getState().status.toUpperCase());
    renderInstrumentation(root, snapshot);
  };
}

function renderInstrumentation(root: HTMLElement, snapshot: ProfilerSnapshot): void {
  rows(element(root, '[data-list="instrumentation"]'), [
    ["CPU scopes", snapshot.scopesRequested ? "REQUESTED" : "OFF"],
    ["Tracing", snapshot.traceEnabled ? "ON" : "OFF"],
  ]);
  element(root, '[data-action="trace"]').setAttribute(
    "aria-pressed",
    String(snapshot.traceEnabled),
  );
}

function appendCapture(list: HTMLElement, profiler: Profiler, capture: SavedCapture): HTMLElement {
  const document = list.ownerDocument;
  const card = document.createElement("article");
  card.className = "jank-capture";
  const title = document.createElement("p");
  title.textContent = `#${capture.id} ${capture.kind.toUpperCase()} · ${capture.frameCount} FRAMES · ${milliseconds(capture.durationMs, 0)} MS${capture.truncated ? " · TRUNCATED" : ""}`;
  const chart = document.createElement("canvas");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `Capture ${capture.id} frame durations`);
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "jl-btn jl-small";
  exportButton.textContent = "EXPORT JSON";
  exportButton.setAttribute("aria-label", `Export capture ${capture.id}`);
  exportButton.dataset.captureId = String(capture.id);
  exportButton.dataset.action = "export-capture";
  card.append(title, chart, exportButton);
  list.append(card);
  const recording = profiler.capture.read(capture.id);
  if (recording) {
    const coverage = document.createElement("p");
    coverage.className = "jank-note";
    coverage.textContent = coverageText(summarizeGpuCoverage(recording));
    title.after(coverage);
    const stats = summarizeFrames(recording.frames, recording.targetFps);
    drawFrameChart(chart, {
      frames: recording.frames,
      budgetMs: 1000 / recording.targetFps,
      limitMs: stats?.limitMs ?? 1000 / recording.targetFps,
    });
  }
  return card;
}

import { type GpuCoverage, summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";
