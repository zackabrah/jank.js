import type {
  ComparisonHost,
  CreateLoadingProfiler,
  GpuFrameResolver,
  GpuState,
} from "../../packages/jank/src/index.ts";
import {
  createComparison,
  createPanel,
  createProfiler,
  createViewer,
  inspectFrame,
  parseComparison,
  parseRecording,
} from "../../packages/jank/src/index.ts";
import { createTabs } from "../../packages/junkui/src/index.ts";

// These declarations are compile-time consumers, not placeholder implementations.
declare const createLoadingProfiler: CreateLoadingProfiler;
declare const container: HTMLElement;
declare const gpuResolver: GpuFrameResolver;
declare const comparisonHost: ComparisonHost;
declare const tablist: HTMLElement;
declare const firstTab: HTMLButtonElement;
declare const firstPanel: HTMLElement;

const profiler = createProfiler({ targetFps: 60, now: () => performance.now() });
const comparison = createComparison({ profiler, host: comparisonHost, gpuResolver });
const channel = profiler.createChannel({ id: "physics", label: "Physics" });
const panel = createPanel({
  container,
  profiler,
  mode: "mini",
  gpuResolver,
  exportTimeoutMs: 2000,
  comparison,
});
const releaseScopes = profiler.requestScopes();
const atMs = performance.now();
const frameId = profiler.beginFrame(atMs);
comparison.tick(atMs, frameId);
const token = channel.begin();
channel.end(token);
profiler.endFrame({ updateMs: 1, renderMs: 2 });
panel.refresh(performance.now());
profiler.observeGpu({
  status: "ready",
  currentRendererFrameId: 12,
  sample: {
    frameId,
    rendererFrameId: 10,
    measurement: "pass-sum",
    durationMs: 3,
    passes: [{ label: "opaque", durationMs: 3 }],
    omittedPasses: 0,
  },
  droppedSamples: 0,
});

// @ts-expect-error A clock reading is not a scope token.
channel.end(performance.now());

const snapshot = profiler.snapshot();
// @ts-expect-error A consumer cannot mutate a returned collection.
snapshot.frames.length = 0;

// @ts-expect-error Ready GPU state requires its measured sample and frame context.
const incompleteGpu: GpuState = { status: "ready" };
profiler.observeGpu(incompleteGpu);

// @ts-expect-error An explicitly provided option cannot be undefined.
createProfiler({ targetFps: undefined });

profiler.capture.arm({ thresholdMs: 40, beforeFrames: 120, afterFrames: 60, cooldownMs: 5000 });
const capture = profiler.capture.getState();
if (capture.status === "collecting") {
  console.info(capture.remainingFrames);
}

const loading = createLoadingProfiler();
const run = loading.beginRun({ label: "Level one", kind: "fresh-context" });
const operation = run.startStage("textures");
operation.recordCache("hit");
operation.addReceivedBytes(4096);
operation.finish("ready");
run.finish("ready");

const viewer = createViewer({ container });
const comparisonFile = parseComparison("{}");
if (comparisonFile.ok) {
  viewer.loadComparison(comparisonFile.comparison);
  viewer.selectTrial(0);
  viewer.setRange(0, 100);
  viewer.selectComparisonTime(250);
}
viewer.import("{}");
const result = parseRecording("{}");
if (result.ok) {
  viewer.load(result.recording);
  const summary = inspectFrame(result.recording, 1);
  if (summary) {
    console.info(summary.coverage.status, summary.attributedMs, summary.likelyCause);
    // @ts-expect-error Inspection results cannot mutate recorded scopes.
    summary.scopes[0].endedAtMs = 0;
  }
} else {
  console.error(result.problem.message);
  // @ts-expect-error A failed import has no valid recording to load.
  viewer.load(result.recording);
}

const tabs = createTabs({
  tablist,
  tabs: [{ id: "one", button: firstTab, panel: firstPanel }],
  selectedId: "one",
});
tabs.select("one");
tabs.dispose();
releaseScopes();
panel.dispose();
channel.dispose();
profiler.dispose();
viewer.dispose();
loading.dispose();

// Optional adapters accept actual renderer/context types without importing a renderer at runtime.
import type { WebGPURenderer } from "three/webgpu";
import { createThreeWebGpuSource } from "../../packages/jank/src/adapters/three-webgpu.ts";
import { createWebGl2GpuSource } from "../../packages/jank/src/adapters/webgl2.ts";

declare const webglContext: WebGL2RenderingContext;
declare const webgpuRenderer: WebGPURenderer;
const glTimer = createWebGl2GpuSource(webglContext, { onSample: profiler.observeGpu });
const gpuTimer = createThreeWebGpuSource(webgpuRenderer, {
  revision: "186",
  enabled: true,
  onSample: profiler.observeGpu,
});
glTimer.beginPass("render");
glTimer.endPass();
glTimer.captureFrame(null);
gpuTimer.beginFrame(null);
gpuTimer.withPass({ id: "compute", label: "Compute", category: "simulation" }, () => {});
gpuTimer.endFrame();
glTimer.dispose();
gpuTimer.dispose();
