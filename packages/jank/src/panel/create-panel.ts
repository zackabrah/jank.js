import { createTabs } from "junkui";
import { summarizeFrames } from "../analysis/statistics.ts";
import { createViewerHandoff } from "../browser/viewer-handoff.ts";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import type { GpuSource } from "../sources.ts";
import {
  createCaptureView,
  initializeCapture,
  readCaptureOptions,
  renderCaptureProgress,
} from "./capture-view.ts";
import { createComparisonView } from "./comparison-view.ts";
import { element, write } from "./dom.ts";
import { createDownload } from "./download.ts";
import { createRecordingExporter } from "./export-recording.ts";
import { createGpuView } from "./gpu-view.ts";
import { createIntegrationView } from "./integration-view.ts";
import { createLiveView, renderOverhead } from "./live-view.ts";
import { createLoadingView } from "./loading-view.ts";
import { panelMarkup } from "./markup.ts";
import type { Panel, PanelMode, PanelOptions } from "./panel.ts";

const storageKey = "jank.js:panel-mode";

function validateMode(mode: PanelMode): void {
  if (mode !== "line" && mode !== "mini" && mode !== "full") {
    throw new TypeError("Panel mode must be line, mini or full");
  }
}

function rememberedMode(window: Window | null, fallback: PanelMode): PanelMode {
  try {
    const saved = window?.localStorage.getItem(storageKey);
    return saved === "line" || saved === "mini" || saved === "full" ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function createPanel(options: PanelOptions): Panel {
  validateMode(options.mode ?? "line");
  const { container, profiler } = options;
  const document = container.ownerDocument;
  const window = document.defaultView;
  const download = createDownload(document);
  const handoff = createViewerHandoff({
    window,
    viewerUrl: options.viewerUrl,
    save: download.save,
    changed: safelyRedraw,
  });
  const exporter = createRecordingExporter({
    profiler,
    ...(options.gpuResolver ? { resolver: options.gpuResolver } : {}),
    timeoutMs: options.exportTimeoutMs ?? 2000,
    save: download.save,
    changed: safelyRedraw,
  });
  const root = document.createElement("aside");
  root.className = "jl jank";
  root.setAttribute("aria-label", "jank.js performance");
  root.dataset.corner = options.corner ?? "top-right";
  root.innerHTML = panelMarkup();
  root.dataset.viewerEnabled = String(Boolean(options.viewerUrl));
  element<HTMLButtonElement>(root, '[data-action="open-viewer"]').hidden = !options.viewerUrl;
  write(root, "gpu-source", options.gpu?.label ?? "ASYNCHRONOUS");
  write(
    root,
    "isolation",
    window?.crossOriginIsolated ? "Cross-origin isolated" : "Not cross-origin isolated",
  );
  const gpuView = createGpuView(root, options.gpuPassOrder);
  container.append(root);
  const liveView = createLiveView(root);
  const loadingView = createLoadingView(root, options.loading);
  const integrationView = createIntegrationView(root, options, safelyRedraw);
  let disposed = false;
  let mode = rememberedMode(window, options.mode ?? "line");
  let selectedTab = "live";
  let releaseScopes: (() => void) | null = null;
  let frozen: ProfilerSnapshot | null = null;
  let lastRefreshMs = -Infinity;
  let refreshIntervalMs = 100;
  let current = profiler.snapshot();
  const renderCaptures = createCaptureView(root, profiler, exporter);
  initializeCapture(root, profiler);
  const comparisonView = options.comparison
    ? createComparisonView(root, options.comparison, {
        changed: safelyRedraw,
        saveJson: download.saveJson,
      })
    : null;

  function showError(error: unknown): void {
    if (disposed) {
      return;
    }
    const alert = element<HTMLElement>(root, '[role="alert"]');
    alert.textContent = error instanceof Error ? error.message : "The panel action failed.";
    alert.hidden = false;
  }

  function redraw(): void {
    profiler.measureRefresh(() => {
      current = profiler.snapshot();
      renderState();
      if (mode === "full") {
        renderCaptureProgress(root, profiler, current);
        renderOverhead(root, current);
        if (selectedTab === "capture") {
          renderCaptures(current);
          renderViewerTransfer();
          comparisonView?.render();
          return;
        }
        if (selectedTab === "loading") {
          loadingView.render();
          return;
        }
      }
      const displayed = frozen ?? current;
      liveView.render(displayed, mode, frozen === null);
      if (mode === "full") {
        gpuView.render(displayed.gpu, 1000 / displayed.targetFps);
        integrationView.render();
      }
    });
    const costMs = current.overhead.refresh.averageMs;
    if (costMs > 0.25) {
      refreshIntervalMs = 250;
    } else if (costMs < 0.1) {
      refreshIntervalMs = 100;
    }
  }

  function renderState(): void {
    const state = profiler.capture.getState();
    const recording = state.status === "manual";
    let label = state.status.toUpperCase();
    if (recording) {
      label = `REC ${state.recordedFrames}`;
    } else if (frozen) {
      label = "FROZEN";
    }
    write(root, "state", label);
    write(root, "line-recording", recording ? "REC" : "");
    write(root, "mini-state", label);
    renderGpuControl(root, options.gpu);
    const recordButton = element<HTMLButtonElement>(root, '[data-action="record"]');
    recordButton.textContent = recording ? "STOP REC" : "REC";
    recordButton.setAttribute("aria-pressed", String(recording));
    renderExportState(root, exporter.state(), recording);
    renderViewerTransfer();
    renderFreezeControls(root, frozen !== null);
    comparisonView?.render();
    write(root, "header-budget", (1000 / (frozen ?? current).targetFps).toFixed(1));
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-fps]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.fps) === current.targetFps));
    }
    element(root, '[data-action="custom-fps"]').setAttribute(
      "aria-pressed",
      String(![30, 60, 120].includes(current.targetFps)),
    );
  }

  const id = `jank-${crypto.randomUUID()}`;
  const tabs = createTabs({
    tablist: element(root, "[data-tabs]"),
    tabs: ["live", "loading", "capture"].map((name) => {
      const button = element<HTMLButtonElement>(root, `[data-tab="${name}"]`);
      const panel = element<HTMLElement>(root, `[data-tabpanel="${name}"]`);
      button.id = `${id}-${name}-tab`;
      panel.id = `${id}-${name}-panel`;
      return { id: name, button, panel };
    }),
    selectedId: selectedTab,
    onSelect: (name) => {
      liveView.stop();
      selectedTab = name;
      safelyRedraw();
    },
  });

  function setMode(nextMode: PanelMode, moveFocus = false): void {
    if (disposed) {
      return;
    }
    validateMode(nextMode);
    const rehome = moveFocus || root.contains(document.activeElement);
    liveView.stop();
    mode = nextMode;
    root.dataset.mode = mode;
    for (const view of root.querySelectorAll<HTMLElement>("[data-view]")) {
      view.hidden = view.dataset.view !== mode;
    }
    if (mode === "line") {
      releaseScopes?.();
      releaseScopes = null;
    } else {
      releaseScopes ??= profiler.requestScopes();
    }
    try {
      window?.localStorage.setItem(storageKey, mode);
    } catch {
      // Preferences are optional; blocked storage must not disable the panel.
    }
    safelyRedraw();
    if (rehome) {
      const action = mode === "full" ? "mini" : "full";
      element<HTMLButtonElement>(root, `[data-view="${mode}"] [data-action="${action}"]`).focus();
    }
  }

  function safelyRedraw(): void {
    if (disposed) {
      return;
    }
    try {
      redraw();
    } catch (error) {
      showError(error);
    }
  }

  function renderViewerTransfer(): void {
    const transfer = handoff.state();
    element<HTMLButtonElement>(root, '[data-action="open-viewer"]').textContent =
      profiler.capture.getState().status === "manual" ? "STOP & VIEWER" : "OPEN VIEWER";
    const notice = element<HTMLElement>(root, "[data-viewer-transfer-status]");
    element<HTMLButtonElement>(root, '[data-action="retry-viewer-download"]').hidden =
      !transfer.canRetry;
    notice.hidden = transfer.message === "";
    if (notice.textContent !== transfer.message) {
      notice.textContent = transfer.message;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      '[data-action="open-viewer"], [data-action="open-capture"]',
    )) {
      button.disabled = exporter.state().busy || transfer.busy;
    }
  }
  function openViewer(id?: number): void {
    if (exporter.state().busy) {
      return;
    }
    const destination = handoff.open();
    if (destination) {
      let delivered = false;
      exporter
        .export(id, {
          ...destination,
          save: (recording) => {
            delivered = true;
            destination.save(recording);
          },
        })
        .then(() => {
          if (!delivered) {
            destination.cancel();
            safelyRedraw();
          }
        })
        .catch((error: unknown) => {
          destination.cancel();
          showError(error);
          safelyRedraw();
        });
    }
  }
  function comparisonAction(name: string): void {
    if (exporter.state().busy) {
      throw new Error("Wait for the current export to finish.");
    }
    comparisonView?.action(name);
  }
  const actions: Readonly<Record<string, () => void>> = {
    "comparison-start": () => comparisonAction("comparison-start"),
    "comparison-stop": () => comparisonAction("comparison-stop"),
    "comparison-export": () => comparisonAction("comparison-export"),
    line: () => setMode("line", true),
    mini: () => setMode("mini", true),
    full: () => setMode("full", true),
    freeze: () => {
      liveView.stop();
      loadingView.freeze(frozen === null);
      integrationView.freeze(frozen === null);
      frozen = frozen ? null : profiler.snapshot();
    },
    record: () => {
      if (profiler.capture.getState().status === "manual") {
        profiler.capture.stop();
      } else {
        profiler.capture.start();
      }
    },
    clear: () => {
      options.comparison?.cancel("Profiler cleared; comparison cancelled.");
      handoff.clear();
      exporter.clear();
      liveView.clear();
      profiler.clear();
      gpuView.clear();
      frozen = null;
      loadingView.freeze(false);
      integrationView.freeze(false);
    },
    "open-viewer": () => openViewer(),
    "retry-viewer-download": () => handoff.retry(),
    export: () => {
      exporter.export().catch(showError);
    },
    arm: () => profiler.capture.arm(readCaptureOptions(root)),
    disarm: () => profiler.capture.disarm(),
    budget: () =>
      profiler.setTargetFps(element<HTMLInputElement>(root, '[data-input="fps"]').valueAsNumber),
    "custom-fps": () => {
      const input = element<HTMLInputElement>(root, '[data-input="fps"]');
      input.focus();
      input.select();
    },
    summary: () => {
      const snapshot = frozen ?? profiler.snapshot();
      const stats = summarizeFrames(snapshot.frames, snapshot.targetFps);
      write(
        root,
        "summary",
        stats
          ? `${snapshot.frames.length} frames. ${stats.fps ?? "Unknown"} FPS. Average ${stats.averageMs.toFixed(1)} ms, p95 ${stats.p95Ms.toFixed(1)} ms. Worst ${stats.worstMs.toFixed(1)} ms at frame ${stats.worstFrameId}. ${stats.missedFrames} frames over budget. Budget ${stats.budgetMs.toFixed(1)} ms. GPU ${snapshot.gpu?.status ?? "unavailable"}.`
          : "No complete frames yet.",
      );
    },
    trace: () => profiler.setTraceEnabled(!profiler.snapshot().traceEnabled),
    gpu: () => {
      const source = options.gpu;
      if (source) {
        const status = source.read().status;
        source.setEnabled(status !== "pending" && status !== "ready");
      }
    },
  };

  function click(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button || !root.contains(button)) {
      return;
    }
    element<HTMLElement>(root, '[role="alert"]').hidden = true;
    try {
      if (button.dataset.action === "budget-preset") {
        const targetFps = Number(button.dataset.fps);
        profiler.setTargetFps(targetFps);
        element<HTMLInputElement>(root, '[data-input="fps"]').value = String(targetFps);
      } else if (button.dataset.action === "open-capture") {
        openViewer(Number(button.dataset.captureId));
      } else if (button.dataset.action === "export-capture") {
        exporter.export(Number(button.dataset.captureId)).catch(showError);
      } else {
        actions[button.dataset.action ?? ""]?.();
      }
      safelyRedraw();
    } catch (error) {
      showError(error);
    }
  }

  root.addEventListener("click", click);
  setMode(mode);
  return {
    refresh: (atMs) => {
      if (disposed || !Number.isFinite(atMs)) {
        return;
      }
      const intervalMs = mode === "line" ? 250 : refreshIntervalMs;
      if (atMs >= lastRefreshMs && atMs - lastRefreshMs < intervalMs) {
        return;
      }
      lastRefreshMs = atMs;
      safelyRedraw();
    },
    setMode,
    dispose: () => {
      if (!disposed) {
        disposed = true;
        releaseScopes?.();
        releaseScopes = null;
        liveView.dispose();
        integrationView.dispose();
        tabs.dispose();
        root.removeEventListener("click", click);
        comparisonView?.dispose();
        handoff.dispose();
        exporter.dispose();
        download.dispose();
        gpuView.clear();
        root.remove();
      }
    },
  };
}

function renderGpuControl(root: HTMLElement, source?: GpuSource): void {
  if (!source) {
    return;
  }
  const status = source.read().status;
  const enabled = status === "pending" || status === "ready";
  const button = element<HTMLButtonElement>(root, '[data-action="gpu"]');
  button.hidden = false;
  button.disabled = status === "unsupported";
  button.textContent = enabled ? "DISABLE GPU" : "ENABLE GPU";
  button.setAttribute("aria-label", enabled ? "Disable GPU timing" : "Enable GPU timing");
  button.setAttribute("aria-pressed", String(enabled));
  button.title = source.label;
}

function renderFreezeControls(root: HTMLElement, frozen: boolean): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="freeze"]')) {
    button.setAttribute("aria-pressed", String(frozen));
    if (button.classList.contains("jl-icon")) {
      const label = frozen ? "Resume display" : "Freeze display";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.textContent = frozen ? "▶" : "Ⅱ";
    } else {
      button.textContent = frozen ? "RESUME" : "FREEZE";
    }
  }
}

function renderExportState(
  root: HTMLElement,
  exporting: { busy: boolean; message: string },
  recording: boolean,
): void {
  const exportButton = element<HTMLButtonElement>(root, '[data-action="export"]');
  exportButton.textContent = recording ? "STOP & EXPORT" : "EXPORT JSON";
  if (exporting.busy) {
    exportButton.textContent = "FINALIZING…";
  }
  exportButton.disabled = exporting.busy;
  const exportStatus = element<HTMLElement>(root, "[data-export-status]");
  exportStatus.hidden = exporting.message === "";
  if (exportStatus.textContent !== exporting.message) {
    exportStatus.textContent = exporting.message;
  }
}
