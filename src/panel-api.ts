/** Public panel API (`jank.js/panel`). Importing this module does not access the DOM. */
import {
  type CaptureSource,
  createCaptureController,
  type SavedCapture,
} from "./capture/controller.ts";
import type { ReadInstrumentation } from "./capture/instrumentation-model.ts";
import { createRuleCaptureSource } from "./capture/rule-source.ts";
import { type ComparisonHost, createComparisonController } from "./compare/controller.ts";
import type { createDiagnostics } from "./core/diagnostics.ts";
import {
  adaptGpu,
  type DiagnosticsSource,
  mountDiagnosticsPanel,
} from "./live/diagnostics-adapter.ts";
import { completeGpuSpan, type LiveGpu } from "./live/model.ts";
import type { LoadingSnapshot } from "./loading/model.ts";
import type { GpuProfile } from "./types/gpu-profile-types.ts";

export type { SavedCapture } from "./capture/controller.ts";
export type { ComparisonBundle, ComparisonPlan, ComparisonVariant } from "./compare/model.ts";
export type { LiveGpu } from "./live/model.ts";
export type { LoadingSnapshot } from "./loading/model.ts";

/** The collector's live history length; its recording capacity is separate. */
const recentFrameCapacity = 600;
const viewportInset = 20;

/** What `jank.js/adapters/webgl2` and `jank.js/adapters/three-webgpu` return. */
export interface PerformanceGpuSource {
  read(): GpuProfile | undefined;
  setEnabled(enabled: boolean): void;
}

export type PerformancePanelCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface PerformancePanelOptions {
  /** The panel is added to this element. */
  shell: HTMLElement;
  /** Viewport corner it floats in, over the page. `"none"` renders inline, for your own layout. */
  corner?: PerformancePanelCorner | "none";
  monitor: ReturnType<typeof createDiagnostics>;
  /** An adapter's GPU source, or a function returning the latest reading (see `jank.js/gpu`). */
  gpu?: PerformanceGpuSource | (() => LiveGpu | null);
  /** Frame-linked GPU evidence for captures. `startRecording` must call the monitor's. */
  capture?: Pick<
    CaptureSource,
    "startRecording" | "recordingFrameIds" | "gpuCoverage" | "finalizeGpu"
  >;
  /** Fills the Loading tab, which is hidden without it. */
  loading?: () => LoadingSnapshot | null;
  /** Extra host controls for Capture → Instrumentation, such as GPU timing. */
  instrumentation?: ReadInstrumentation;
  /** Adds the Compare tab: two reported variants and synchronous workload switches. */
  comparison?: Omit<ComparisonHost, "capture">;
  /** Replaces the built-in recording viewer, which loads only when first opened. */
  onOpenCapture?: (capture: SavedCapture) => void | Promise<void>;
}

/**
 * Mounts the live panel. Call `refresh(at)` once per frame, straight after `monitor.beginFrame(at)`:
 * that is when the previous frame is sealed and before the next frame's work starts.
 */
export function createPerformancePanel(options: PerformancePanelOptions) {
  const { shell, monitor, corner = "top-right", comparison: comparisonHost } = options;
  // The Live tab's CPU rows need per-frame scopes, which the collector keeps only when asked.
  monitor.setExpanded(true);
  const container = shell.ownerDocument.createElement("div");
  if (corner !== "none") {
    const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"];
    // A guest over the page: it never resizes the host's layout, and stays reachable when short.
    Object.assign(container.style, {
      position: "fixed",
      [vertical]: `${viewportInset}px`,
      [horizontal]: `${viewportInset}px`,
      zIndex: "2147483000",
      maxHeight: `calc(100vh - ${viewportInset * 2}px)`,
      overflowY: "auto",
    });
  }
  shell.append(container);
  const collector: CaptureSource & DiagnosticsSource = monitor;
  // The panel's last reading, up to one refresh old, so rules add no GPU reads of their own.
  let latestGpu: LiveGpu | null = null;
  const source = createRuleCaptureSource(
    {
      ...collector,
      recentFrameCapacity,
      ...options.capture,
    },
    () => completeGpuSpan(latestGpu),
  );
  const capture = createCaptureController(source);
  const comparison = comparisonHost
    ? createComparisonController({ capture, ...comparisonHost })
    : undefined;
  let traceEnabled = false;
  const traceEvents = {
    get enabled() {
      return traceEnabled;
    },
    setEnabled(enabled: boolean) {
      monitor.setDevToolsEnabled(enabled);
      traceEnabled = enabled;
    },
  };
  // Adapter sources report into the collector, so recordings keep their GPU samples too.
  const gpuSource = typeof options.gpu === "object" ? options.gpu : undefined;
  let gpuEnabled = true;
  const gpuTiming = gpuSource && {
    get enabled() {
      return gpuEnabled;
    },
    setEnabled(enabled: boolean) {
      gpuSource.setEnabled(enabled);
      gpuEnabled = enabled;
    },
  };
  const readGpu = gpuSource
    ? () => {
        const profile = gpuSource.read();
        if (!profile) return null;
        monitor.observeGpu(profile);
        return adaptGpu(profile);
      }
    : typeof options.gpu === "function"
      ? options.gpu
      : undefined;
  let closeViewer = () => {};
  // Nothing renders before the first refresh, which would otherwise look like a broken install.
  const refreshHint = setTimeout(() => {
    console.warn(
      "jank.js: the panel draws from panel.refresh(at), which hasn't been called. Call it once per frame, straight after monitor.beginFrame(at).",
    );
  }, 5000);
  let destroyed = false;
  const openViewer = async (saved: SavedCapture) => {
    const { openRecordingViewer } = await import("./viewer/mount.tsx");
    if (destroyed) return;
    closeViewer();
    closeViewer = openRecordingViewer(shell.ownerDocument, saved);
  };
  const panel = mountDiagnosticsPanel(
    container,
    { ...source, measureRefresh: monitor.measureRefresh, setTargetFps: monitor.setTargetFps },
    readGpu &&
      (() => {
        latestGpu = readGpu();
        return latestGpu;
      }),
    { controller: capture, onOpen: options.onOpenCapture ?? openViewer },
    () => ({ traceEvents, ...(gpuTiming ? { gpuTiming } : {}), ...options.instrumentation?.() }),
    options.loading,
    comparison,
  );
  return {
    /** Manual and automatic capture state; drive it for host-side stop-and-save. */
    capture,
    /** Present only when `comparison` was supplied. */
    comparison,
    refresh(at: number = performance.now(), force = false) {
      // Measured, so the runner's own cost appears in the overhead footer and profiler lane.
      clearTimeout(refreshHint);
      if (comparison) monitor.measureRefresh(() => comparison.advance(false));
      panel.refresh(at, force);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(refreshHint);
      comparison?.destroy();
      capture.discard();
      closeViewer();
      panel.destroy();
      monitor.setExpanded(false);
      container.remove();
    },
  };
}
