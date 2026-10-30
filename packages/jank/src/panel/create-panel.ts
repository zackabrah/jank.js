import { createTabs } from "junkui";
import type { ProfilerSnapshot } from "../core/snapshot.ts";
import type { GpuSource } from "../sources.ts";
import {
  createCaptureView,
  initializeCapture,
  readCaptureOptions,
  renderCaptureProgress,
} from "./capture-view.ts";
import { element, write } from "./dom.ts";
import { createDownload } from "./download.ts";
import { renderLive, renderOverhead } from "./live-view.ts";
import { renderLoading } from "./loading-view.ts";
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
  const root = document.createElement("aside");
  root.className = "jl jank";
  root.setAttribute("aria-label", "jank.js performance");
  root.dataset.corner = options.corner ?? "top-right";
  root.innerHTML = panelMarkup();
  container.append(root);
  let disposed = false;
  let mode = rememberedMode(window, options.mode ?? "line");
  let selectedTab = "live";
  let releaseScopes: (() => void) | null = null;
  let frozen: ProfilerSnapshot | null = null;
  let lastRefreshMs = -Infinity;
  let refreshIntervalMs = 100;
  let current = profiler.snapshot();
  const download = createDownload(document);
  const renderCaptures = createCaptureView(root, profiler);
  initializeCapture(root, profiler);

  function showError(error: unknown): void {
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
          return;
        }
        if (selectedTab === "loading") {
          renderLoading(root, options.loading);
          return;
        }
      }
      renderLive(root, frozen ?? current, mode);
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
    const freezeButton = element<HTMLButtonElement>(root, '[data-action="freeze"]');
    freezeButton.textContent = frozen ? "RESUME" : "FREEZE";
    freezeButton.setAttribute("aria-pressed", String(frozen !== null));
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
      element<HTMLButtonElement>(root, `[data-view="${mode}"] button`).focus();
    }
  }

  function safelyRedraw(): void {
    try {
      redraw();
    } catch (error) {
      showError(error);
    }
  }

  const actions: Readonly<Record<string, () => void>> = {
    line: () => setMode("line", true),
    mini: () => setMode("mini", true),
    full: () => setMode("full", true),
    freeze: () => {
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
      profiler.clear();
      frozen = null;
    },
    export: () => {
      const latest = profiler.capture.list().at(-1);
      download.save((latest && profiler.capture.read(latest.id)) || profiler.capture.recent());
    },
    arm: () => profiler.capture.arm(readCaptureOptions(root)),
    disarm: () => profiler.capture.disarm(),
    budget: () =>
      profiler.setTargetFps(element<HTMLInputElement>(root, '[data-input="fps"]').valueAsNumber),
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
      if (button.dataset.action === "export-capture") {
        const recording = profiler.capture.read(Number(button.dataset.captureId));
        if (!recording) {
          throw new Error("This capture is no longer retained.");
        }
        download.save(recording);
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
        tabs.dispose();
        root.removeEventListener("click", click);
        download.dispose();
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
