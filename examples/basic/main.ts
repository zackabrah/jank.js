import {
  createPanel,
  createProfiler,
  type Panel,
  type PanelMode,
} from "../../packages/jank/src/index.ts";
import { createComparison } from "./comparison.ts";
import { createTraceExample } from "./example-sources.ts";
import { createDemoGpu, type DemoGpuMode } from "./gpu-source.ts";
import { createHeadroomTest } from "./headroom.ts";
import { createLoadingExample } from "./loading-example.ts";
import { bindRecordingFile } from "./recording-file.ts";
import { createScene } from "./scene.ts";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing demo control: ${id}`);
  }
  // All IDs and element types are owned by this example's static HTML.
  return found as T;
}

const canvas = element<HTMLCanvasElement>("scene");
const objectCount = element<HTMLSelectElement>("objects");
const cpuLoad = element<HTMLSelectElement>("cpu-load");
const counterError = element<HTMLInputElement>("counter-error");
const scopeDemand = element<HTMLInputElement>("scope-demand");
const gpuControl = element<HTMLSelectElement>("gpu-example");
const panelToggle = element<HTMLButtonElement>("panel-toggle");
const profilerToggle = element<HTMLButtonElement>("profiler-toggle");
const loadingButton = element<HTMLButtonElement>("loading");
const pauseButton = element<HTMLButtonElement>("pause");
const status = element("action-status");
const loading = createLoadingExample();
let traceOriginMs = 0;
const trace = createTraceExample(() => traceOriginMs);
let panel: Panel | null = null;
let releaseScopes: (() => void) | null = null;
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pendingHitch = false;
let hostFrames = 0;
let lastFrameMs = performance.now();
let lastReadoutMs = -Infinity;
let frameRequest = 0;
let disposed = false;
let comparison: ReturnType<typeof createComparison> | null = null;

function reportError(cause: unknown): void {
  const alert = element("demo-error");
  alert.hidden = false;
  alert.textContent = cause instanceof Error ? cause.message : "Unable to run the scene.";
}

function startScene() {
  try {
    return loading.initialize(() => createScene(canvas));
  } catch (cause) {
    reportError(cause);
    return null;
  }
}

const scene = startScene();
const gpu = createDemoGpu(scene?.context ?? null, (state) => {
  instrumentation?.profiler.observeGpu(state);
  headroom.gpu(state);
});

function startProfiler() {
  let firstClockRead = true;
  const profiler = createProfiler({
    application: { name: "jank.js basic demo" },
    now: () => {
      const nowMs = performance.now();
      if (firstClockRead) {
        traceOriginMs = nowMs;
        firstClockRead = false;
      }
      return nowMs;
    },
    trace: trace.sink,
  });
  gpu.reset();
  const animation = profiler.createChannel({
    id: "animation",
    label: "animation",
    readCounters: () => ({
      paused: !(comparison?.settings()?.animate ?? (!paused || headroom.active())),
      extraMs: comparison?.settings()?.cpuMs ?? (headroom.active() ? 0 : Number(cpuLoad.value)),
    }),
  });
  const workload = profiler.createChannel({ id: "workload", label: "deliberate CPU work" });
  const render = profiler.createChannel({
    id: "render",
    label: "render submit",
    readCounters: () => {
      if (counterError.checked) {
        throw new Error("Intentional demo counter failure");
      }
      return scene?.counters() ?? { renderer: "WebGL unavailable" };
    },
  });
  if (scopeDemand.checked) {
    releaseScopes = profiler.requestScopes();
  }
  return { profiler, animation, workload, render };
}

let instrumentation: ReturnType<typeof startProfiler> | null = startProfiler();
const headroom = createHeadroomTest({
  scene,
  gpu,
  canvas,
  profiler: () => instrumentation?.profiler ?? null,
  canStart: () => loading.source.snapshot()?.status !== "loading" && !comparison?.active(),
});

comparison = createComparison({
  scene,
  gpu,
  canvas,
  profiler: () => instrumentation?.profiler ?? null,
  canStart: () => !headroom.active() && loading.source.snapshot()?.status !== "loading",
  settings: () => ({
    objects: Number(objectCount.value),
    cpuMs: Number(cpuLoad.value),
    animate: !paused,
    scale: scene?.resolutionScale() ?? 1,
  }),
});

function attachPanel(mode?: PanelMode): void {
  if (!instrumentation || panel) {
    return;
  }
  const experiment = comparison?.controller();
  panel = createPanel({
    container: element("panel-mount"),
    profiler: instrumentation.profiler,
    viewerUrl: new URL("../viewer/", import.meta.url).href,
    mode: "full",
    gpu: gpu.source,
    loading: loading.source,
    ...(scene ? { visibility: scene.visibility, temporal: scene.temporal } : {}),
    ...(experiment ? { comparison: experiment } : {}),
  });
  if (mode) {
    panel.setMode(mode);
  }
  panelToggle.textContent = "Detach panel";
}

function detachPanel(): void {
  panel?.dispose();
  panel = null;
  panelToggle.textContent = "Attach panel";
}

function stopProfiler(): void {
  comparison?.cancel("Profiler stopped; restart the comparison.");
  headroom.cancel("Profiler stopped; restart to estimate headroom.");
  detachPanel();
  releaseScopes?.();
  releaseScopes = null;
  gpu.dispose();
  instrumentation?.profiler.dispose();
  instrumentation = null;
  trace.clear();
}

/** A bounded, deliberate main-thread stall, requested only by the visible workload controls. */
function spendCpuTime(durationMs: number): void {
  const endMs = performance.now() + durationMs;
  while (performance.now() < endMs) {
    // This is the workload: waiting synchronously forces a measurable long frame.
  }
}

function consumeHitch(): number {
  const requested = pendingHitch;
  pendingHitch = false;
  if (!requested || headroom.active() || comparison?.active()) {
    return 0;
  }
  instrumentation?.profiler.addEvent("Deliberate 80 ms hitch");
  return 80;
}

function frame(atMs: number): void {
  if (disposed) {
    return;
  }
  hostFrames += 1;
  headroom.beforeFrame(atMs);
  const current = instrumentation;
  const frameId = current?.profiler.beginFrame(atMs) ?? -1;
  comparison?.beforeFrame(atMs, frameId);
  const comparisonSettings = comparison?.settings();
  const frameMs = atMs - lastFrameMs;
  const deltaSeconds = Math.min(0.05, Math.max(0, (atMs - lastFrameMs) / 1000));
  lastFrameMs = atMs;
  const updateStartMs = performance.now();
  const animationToken = current?.animation.begin();
  const animate = comparisonSettings?.animate ?? (!paused || headroom.active());
  scene?.update(animate ? deltaSeconds : 0);
  const workloadToken = current?.workload.begin();
  headroom.compute();
  let extraMs = comparisonSettings?.cpuMs ?? (headroom.active() ? 0 : Number(cpuLoad.value));
  extraMs += consumeHitch();
  spendCpuTime(extraMs);
  if (current && workloadToken !== undefined && animationToken !== undefined) {
    current.workload.end(workloadToken);
    current.animation.end(animationToken);
  }
  const renderStartMs = performance.now();
  const renderToken = current?.render.begin();
  gpu.beginPass();
  scene?.render();
  gpu.endPass();
  const renderEndMs = performance.now();
  headroom.frame({ frameId, atMs, cpuMs: renderEndMs - updateStartMs, frameMs });
  if (current && renderToken !== undefined) {
    current.render.end(renderToken);
    current.profiler.endFrame({
      updateMs: renderStartMs - updateStartMs,
      renderMs: renderEndMs - renderStartMs,
    });
    current.profiler.observeGpu(gpu.observe(frameId, hostFrames));
  }
  loading.step(performance.now());
  panel?.refresh(atMs);
  if (atMs - lastReadoutMs >= 250) {
    lastReadoutMs = atMs;
    renderReadout();
  }
  frameRequest = requestAnimationFrame(frame);
}

function renderReadout(): void {
  element("host-frames").textContent = String(hostFrames);
  element("archive-count").textContent = String(
    instrumentation?.profiler.capture.list().length ?? 0,
  );
  element("trace-count").textContent = String(trace.count());
  gpuControl.value = gpu.mode();
  const run = loading.source.snapshot();
  loadingButton.disabled = run?.status === "loading";
  element("loading-status").textContent = run ? `Run ${run.id}: ${run.status}` : "No run yet";
  profilerToggle.textContent = instrumentation ? "Stop profiler" : "Start profiler";
  panelToggle.disabled = instrumentation === null;
  element<HTMLButtonElement>("add-event").disabled = instrumentation === null;
  element("profiler-state").textContent = instrumentation ? "Running" : "Stopped";
  headroom.refresh();
  comparison?.refresh();
}

// Event delegation keeps teardown to one listener; each action still calls the public API directly.
function click(event: MouseEvent): void {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  if (!button) {
    return;
  }
  const actions: Record<string, () => void> = {
    pause: () => {
      paused = !paused;
      pauseButton.textContent = paused ? "Resume motion" : "Pause motion";
    },
    hitch: () => {
      pendingHitch = true;
      status.textContent = "80 ms hitch queued.";
    },
    "capture-hitch": () => {
      if (!instrumentation) {
        status.textContent = "Start the profiler before capturing a hitch.";
        return;
      }
      instrumentation.profiler.capture.stop();
      instrumentation.profiler.capture.arm({
        thresholdMs: 50,
        beforeFrames: 30,
        afterFrames: 10,
        cooldownMs: 5000,
      });
      pendingHitch = true;
      status.textContent = "Capture armed; hitch queued.";
    },
    "add-event": () => {
      instrumentation?.profiler.addEvent(
        element<HTMLInputElement>("event-label").value.trim() || "Demo marker",
      );
      status.textContent = "Marker added.";
    },
    "inspect-culling": () => scene?.toggleInspectionView(),
    "cancel-loading": () => loading.cancel(),
    loading: () => {
      loading.start(() => scene?.setCount(Number(objectCount.value)));
      loadingButton.disabled = true;
      status.textContent = "Loading example started.";
    },
    "clear-trace": () => trace.clear(),
    "panel-line": () => panel?.setMode("line"),
    "panel-mini": () => panel?.setMode("mini"),
    "panel-full": () => panel?.setMode("full"),
    "panel-toggle": () => {
      if (panel) {
        detachPanel();
      } else {
        attachPanel();
      }
    },
    "profiler-toggle": () => {
      if (instrumentation) {
        stopProfiler();
      } else {
        instrumentation = startProfiler();
        attachPanel();
      }
    },
  };
  try {
    actions[button.id]?.();
    renderReadout();
  } catch (cause) {
    reportError(cause);
  }
}

function change(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (target === objectCount) {
    scene?.setCount(Number(objectCount.value));
  } else if (target === gpuControl) {
    gpu.select(gpuControl.value as DemoGpuMode);
  } else if (target === scopeDemand) {
    releaseScopes?.();
    releaseScopes = scopeDemand.checked
      ? (instrumentation?.profiler.requestScopes() ?? null)
      : null;
  }
}

const unbindFile = bindRecordingFile(
  element("recording-file"),
  element("recording-summary"),
  element("import-error"),
);
const controls = element("scene-controls").closest("section");
controls?.addEventListener("click", click);
controls?.addEventListener("change", change);
pauseButton.textContent = paused ? "Resume motion" : "Pause motion";
attachPanel("full");
frameRequest = requestAnimationFrame(frame);

function dispose(): void {
  if (!disposed) {
    disposed = true;
    cancelAnimationFrame(frameRequest);
    comparison?.dispose();
    comparison = null;
    headroom.dispose();
    loading.source.dispose();
    stopProfiler();
    scene?.dispose();
    unbindFile();
    controls?.removeEventListener("click", click);
    controls?.removeEventListener("change", change);
  }
}
window.addEventListener("pagehide", dispose, { once: true });
