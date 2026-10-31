import { summarizeFrames } from "../analysis/statistics.ts";
import { drawFrameChart } from "../charts/frame-chart.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import type { Profiler } from "../profiler.ts";
import type { CaptureOptions, SavedCapture } from "../recordings/capture.ts";
import { gpuCoverageText } from "./capture-description.ts";
import { element, milliseconds, rows, write } from "./dom.ts";
import type { RecordingExporter } from "./export-recording.ts";

export function initializeCapture(root: HTMLElement, profiler: Profiler): void {
  for (const [key, value] of Object.entries(profiler.capture.getOptions())) {
    if (typeof value === "number") {
      element<HTMLInputElement>(root, `[data-input="${key}"]`).value = String(value);
    }
  }
  element<HTMLSelectElement>(root, "[data-trigger-mode]").value =
    profiler.capture.getOptions().sustainedMs === undefined ? "spike" : "sustained";
  const window = profiler.capture.getOptions().timeWindow;
  element<HTMLSelectElement>(root, "[data-capture-window]").value = window ? "episode" : "frames";
  for (const [key, value] of Object.entries(window ?? {})) {
    element<HTMLInputElement>(root, `[data-time-window-input="${key}"]`).value = String(
      value / 1000,
    );
  }
  element<HTMLInputElement>(root, '[data-input="fps"]').value = String(
    profiler.snapshot().targetFps,
  );
}

export function readCaptureOptions(root: HTMLElement): CaptureOptions {
  const milliseconds = (key: string) =>
    1000 * element<HTMLInputElement>(root, `[data-time-window-input="${key}"]`).valueAsNumber;
  const timeWindow =
    element<HTMLSelectElement>(root, "[data-capture-window]").value === "episode"
      ? {
          beforeMs: milliseconds("beforeMs"),
          afterMs: milliseconds("afterMs"),
          recoveryMs: milliseconds("recoveryMs"),
          maxDurationMs: milliseconds("maxDurationMs"),
        }
      : null;
  return {
    ...(timeWindow ? { timeWindow } : {}),
    ...(element<HTMLSelectElement>(root, "[data-trigger-mode]").value === "sustained"
      ? { sustainedMs: element<HTMLInputElement>(root, '[data-input="sustainedMs"]').valueAsNumber }
      : {}),
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
  const coverage = gpuCoverageText(progress.gpu);
  const episode = progress.episode
    ? ` · ${progress.episode.triggerCount} triggers · ${(progress.episode.remainingMs / 1000).toFixed(2)} s to recovery/limit`
    : "";
  write(
    root,
    "capture-health",
    `${coverage} · ${progress.remainingFrames} frames remaining${episode}`,
  );
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

/** Cache only DOM for retained IDs; full recordings are read once when adding a thumbnail. */
export function createCaptureView(
  root: HTMLElement,
  profiler: Profiler,
  exporter: RecordingExporter,
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
    for (const [id, card] of entries) {
      renderExportNotice(card, id, exporter);
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
  const notice = document.createElement("p");
  notice.className = "jank-note";
  notice.dataset.exportNotice = String(capture.id);
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  card.append(title, chart, exportButton, notice);
  if (list.closest<HTMLElement>("[data-viewer-enabled]")?.dataset.viewerEnabled === "true") {
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "jl-btn jl-small";
    openButton.textContent = "OPEN VIEWER";
    openButton.setAttribute("aria-label", `Open capture ${capture.id} in viewer`);
    openButton.dataset.action = "open-capture";
    openButton.dataset.captureId = String(capture.id);
    notice.before(openButton);
  }
  list.append(card);
  const recording = profiler.capture.read(capture.id);
  if (recording) {
    const coverage = document.createElement("p");
    coverage.className = "jank-note";
    coverage.dataset.captureCoverage = "";
    coverage.textContent = gpuCoverageText(summarizeGpuCoverage(recording));
    title.after(coverage);
    if (recording.capture.kind === "automatic" && recording.capture.episode) {
      title.append(
        ` · EPISODE · ${recording.capture.episode.triggerFrameIds.length} TRIGGERS · ${recording.capture.episode.stopReason.toUpperCase()}`,
      );
      exportButton.textContent = "EXPORT EPISODE";
    }
    const stats = summarizeFrames(recording.frames, recording.targetFps);
    drawFrameChart(chart, {
      frames: recording.frames,
      budgetMs: 1000 / recording.targetFps,
      limitMs: stats?.limitMs ?? 1000 / recording.targetFps,
    });
  }
  return card;
}

import { summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";

function renderExportNotice(card: HTMLElement, id: number, exporter: RecordingExporter): void {
  const text = exporter.notice(id);
  const notice = element<HTMLElement>(card, "[data-export-notice]");
  notice.hidden = text === "";
  if (notice.textContent !== text) {
    notice.textContent = text;
  }
  element<HTMLElement>(card, "[data-capture-coverage]").hidden = text !== "";
  element<HTMLButtonElement>(card, '[data-action="export-capture"]').disabled =
    exporter.state().busy;
}
