import {
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  GridHelper,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { readThreeCounters } from "../src/adapters/three-counters.ts";
import { observeThreeInstances } from "../src/adapters/three-instances.ts";
import { installAgentApi } from "../src/agent/api.ts";
import type { SavedCapture } from "../src/capture/controller.ts";
import { createGpuHistory } from "../src/gpu/history.ts";
import { type GpuFrame, gpuFrameToLive } from "../src/gpu/model.ts";
import { createPerformancePanel } from "../src/panel-api.ts";
import type { DiagnosticValues } from "../src/recording/types.ts";
import { loadReferenceMonitor } from "./reference-monitor.ts";
import { createThreeLoadingDemo } from "./three-loading-demo.ts";
import { createThreeRenderer, type ThreeBackend } from "./three-renderer.ts";
import {
  type ComparisonCandidate,
  comparisonVariants,
  type StressSettings,
  stressPresets,
} from "./three-variants.ts";

export interface SceneStats {
  frames: number;
  cpuMs: number;
  submissionMs: number;
  drawCalls: number;
  triangles: number;
  width: number;
  height: number;
  gpuStatus: string;
  gpuEnabled: boolean;
  loadingPhase: string;
}

export async function startThreeScene(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  backend: ThreeBackend,
  signal: AbortSignal,
  onStats: (stats: SceneStats) => void,
  onError: (message: string) => void,
  onOpen: (capture: SavedCapture) => void | Promise<void>,
  compareWith: ComparisonCandidate,
) {
  const monitor = await loadReferenceMonitor(`Jank Three.js ${backend} stress scene`);
  if (signal.aborted) {
    monitor.dispose();
    signal.throwIfAborted();
  }
  let stopped = false;
  let halted = false;
  let currentId = -1;
  let latest: GpuFrame | null = null;
  let pending: GpuFrame | null = null;
  const history = createGpuHistory(6000, () => graphics.poll());
  const receive = (frame: GpuFrame) => {
    if (stopped) return;
    history.record(frame);
    if (frame.invocations.some((pass) => pass.state === "pending")) pending = frame;
    else if (!latest || frame.frameId >= latest.frameId) latest = frame;
  };
  let stop = () => {};
  let halt: (message: string) => void = () => {};
  const fail = (message: string, label = "Renderer failure", asynchronous = false) => {
    if (stopped) return;
    const context = currentId < 0 ? "Before first frame" : `Observed near f${currentId}`;
    const origin = asynchronous ? "; asynchronous report, source frame unknown" : "";
    const detail = `${context}${origin}\n${message}`;
    monitor.event(label, detail);
    halt(message);
    onError(detail);
  };
  const graphics = await createThreeRenderer(canvas, backend, receive, (issue) => {
    fail(issue.detail, issue.label, issue.asynchronous);
  }).catch((error: unknown) => {
    monitor.dispose();
    throw error;
  });
  if (signal.aborted) {
    graphics.dispose();
    monitor.dispose();
    signal.throwIfAborted();
  }
  const { renderer } = graphics;
  const scene = new Scene();
  scene.background = new Color("#080e18");
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(13, 12, 19);
  camera.lookAt(0, 0, 0);
  scene.add(new HemisphereLight(0xbfdfff, 0x15122a, 2));
  const light = new DirectionalLight(0xffffff, 4);
  light.position.set(4, 10, 6);
  scene.add(light);
  const geometry = new IcosahedronGeometry(0.32, 2);
  const material = new MeshStandardMaterial({ roughness: 0.26, metalness: 0.35 });
  const mesh = new InstancedMesh(geometry, material, 2048);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  // Animated instances remain within this fixed scene; avoid stale inferred bounds.
  mesh.frustumCulled = false;
  const instances = observeThreeInstances(mesh, renderer.info);
  const color = new Color();
  for (let i = 0; i < 2048; i++) mesh.setColorAt(i, color.setHSL((i * 0.618) % 1, 0.66, 0.58));
  const grid = new GridHelper(20, 20, 0x4b607c, 0x223048);
  grid.position.y = -1.4;
  scene.add(mesh, grid);
  const loading = createThreeLoadingDemo(scene, camera, renderer);
  const transform = new Object3D();
  const scratch = new Float64Array(256);
  let settings: StressSettings = { ...stressPresets.Baseline };
  let paused = false;
  let gpuEnabled = true;
  let spike = false;
  let time = 0;
  let previousAt = performance.now();
  let recordedIds: number[] = [];
  let cpuMs = 0;
  let submissionMs = 0;
  let drawCalls = 0;
  let triangles = 0;
  let width = 1,
    height = 1;
  let request = 0;
  let lastStats = -Infinity;
  renderer.info.autoReset = false;
  let simulationCounters: DiagnosticValues = {};
  let renderCounters: DiagnosticValues = {};
  const simulation = monitor.register("simulation", "CPU simulation", () => simulationCounters);
  const submission = monitor.register("submission", "Render submission", () => renderCounters);
  const setGpuEnabled = (value: boolean) => {
    if (stopped || halted)
      throw new Error("The renderer has stopped. Reload to change GPU timing.");
    if (!graphics.supported) throw new Error("This renderer has no GPU timestamp query support.");
    graphics.setEnabled(value);
    gpuEnabled = value;
    latest = pending = null;
    monitor.event(value ? "GPU timing enabled" : "GPU timing disabled");
  };
  const applySettings = (next: StressSettings) => {
    settings = { ...next };
    resize();
    monitor.event(
      "Stress settings",
      `${next.cpuMs} ms CPU; ${next.instances} instances; ${next.passes} passes; ${next.resolution}× resolution`,
    );
  };
  let beforeComparison: { settings: StressSettings; paused: boolean; visible: boolean } | null =
    null;
  const panel = createPerformancePanel({
    shell: hud,
    corner: "none",
    monitor,
    gpu: () => {
      const frame = latest ?? pending;
      if (!frame) return null;
      const gpu = gpuFrameToLive(frame, currentId - 1);
      return {
        ...gpu,
        status: !gpuEnabled ? "disabled" : !graphics.supported ? "unsupported" : gpu.status,
      };
    },
    capture: {
      startRecording() {
        recordedIds = [];
        monitor.startRecording();
      },
      recordingFrameIds: () => recordedIds,
      gpuCoverage: history.coverage,
      finalizeGpu: history.finalize,
    },
    instrumentation: () => ({
      gpuTiming: {
        enabled: gpuEnabled && graphics.supported && !halted,
        unavailableReason: halted
          ? "The renderer has stopped. Reload to change GPU timing."
          : !graphics.supported
            ? "This renderer has no GPU timestamp query support."
            : undefined,
        setEnabled: setGpuEnabled,
      },
      traceEvents: monitor.traceEvents,
    }),
    loading: loading.read,
    comparison: {
      ...comparisonVariants(compareWith, backend),
      activate(variant) {
        beforeComparison ??= { settings, paused, visible: mesh.visible };
        // A paused scene or hidden mesh would not run the workload the variant reports.
        paused = spike = false;
        mesh.visible = true;
        applySettings(variant === "A" ? stressPresets.Baseline : stressPresets[compareWith]);
      },
      restore() {
        if (!beforeComparison) return;
        paused = beforeComparison.paused;
        mesh.visible = beforeComparison.visible;
        applySettings(beforeComparison.settings);
        beforeComparison = null;
      },
    },
    onOpenCapture: onOpen,
  });
  const comparison = panel.comparison;
  if (!comparison) throw new Error("The scene always supplies a comparison.");
  const removeAgentApi = installAgentApi(window, panel.capture, { event: monitor.event });
  const resize = () => {
    const bounds = canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(1, Math.floor(bounds?.width ?? 800));
    const h = Math.max(1, Math.floor(bounds?.height ?? 500));
    // Absolute scale, independent of the monitor's DPR; cap GPU allocations for this playground.
    const ratio = Math.min(settings.resolution, 2048 / Math.max(w, h));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    width = canvas.width;
    height = canvas.height;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const contextLost = (event: Event) => {
    event.preventDefault();
    const status =
      "statusMessage" in event && typeof event.statusMessage === "string"
        ? event.statusMessage.slice(0, 1000)
        : "";
    fail(
      `WebGL context lost. Reload the scene to start a new session.${status ? `\n${status}` : ""}`,
      "Renderer failure",
      true,
    );
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  const resetFrame = () => monitor.resetFrame();
  document.addEventListener("visibilitychange", resetFrame);
  stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(request);
    observer.disconnect();
    canvas.removeEventListener("webglcontextlost", contextLost);
    document.removeEventListener("visibilitychange", resetFrame);
    signal.removeEventListener("abort", stop);
    removeAgentApi();
    panel.destroy();
    instances.dispose();
    void loading.dispose().finally(() => graphics.dispose());
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    grid.geometry.dispose();
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const item of materials) item.dispose();
    monitor.dispose();
  };
  signal.addEventListener("abort", stop, { once: true });
  // Keep the panel and saved recordings available after a renderer failure.
  halt = (message) => {
    if (halted) {
      panel.refresh(performance.now(), true);
      return;
    }
    halted = true;
    loading.fail(message);
    cancelAnimationFrame(request);
    observer.disconnect();
    comparison.fail(`Renderer failure: ${message}`);
    if (panel.capture.getSnapshot().phase === "recording") panel.capture.stopAndSave();
    panel.refresh(performance.now(), true);
  };
  const frame = () => {
    if (stopped || halted) return;
    try {
      const at = performance.now();
      const previousId = currentId;
      const recording = monitor.recording;
      currentId = monitor.beginFrame(at);
      if (currentId === previousId) {
        request = requestAnimationFrame(frame);
        return;
      }
      if (recording && previousId >= 0 && recordedIds.length < 6000) recordedIds.push(previousId);
      // beginFrame seals the preceding CPU interval; both observe it before the next workload.
      panel.refresh(at);
      renderer.info.reset();
      instances.beginFrame();
      graphics.beginFrame(currentId);
      cpuMs = submissionMs = drawCalls = triangles = 0;
      if (!paused) {
        time += Math.min((at - previousAt) / 1000, 0.05);
        const started = performance.now();
        const token = simulation.begin();
        const workMs = spike ? 80 : settings.cpuMs;
        spike = false;
        const deadline = performance.now() + workMs;
        while (performance.now() < deadline)
          for (let i = 0; i < scratch.length; i++)
            scratch[i] = Math.sin((scratch[i] ?? 0) + time + i * 0.1);
        mesh.count = settings.instances;
        const side = Math.ceil(Math.sqrt(mesh.count));
        for (let i = 0; i < mesh.count; i++) {
          const x = ((i % side) / Math.max(1, side - 1) - 0.5) * 15;
          const z = (Math.floor(i / side) / Math.max(1, side - 1) - 0.5) * 15;
          transform.position.set(
            x,
            Math.sin(x * 0.7 + time * 1.5) * Math.cos(z * 0.5 + time) +
              (scratch[i % 256] ?? 0) * 0.15,
            z,
          );
          transform.rotation.set(time * 0.4 + i, time * 0.25, 0);
          transform.scale.setScalar(Math.min(1, 19 / side));
          transform.updateMatrix();
          mesh.setMatrixAt(i, transform.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        simulation.end(token);
        cpuMs = performance.now() - started;
        const renderStart = performance.now();
        const renderToken = submission.begin();
        for (let i = 0; i < settings.passes; i++) {
          graphics.beginPass(`Scene ${i + 1}`);
          try {
            renderer.render(scene, camera);
          } finally {
            graphics.endPass();
          }
        }
        submission.end(renderToken);
        submissionMs = performance.now() - renderStart;
        drawCalls =
          "drawCalls" in renderer.info.render
            ? renderer.info.render.drawCalls
            : renderer.info.render.calls;
        triangles = renderer.info.render.triangles;
      }
      previousAt = at;
      // Latch completed work before beginFrame seals it and samples counters on the next tick.
      simulationCounters = { extraWorkMs: settings.cpuMs };
      renderCounters = {
        frameId: currentId,
        ...readThreeCounters(renderer.info),
        ...graphics.gpuCalls(),
        ...instances.read(settings.instances),
        passes: paused ? 0 : settings.passes,
        widthPx: width,
        heightPx: height,
        workloadPaused: paused,
        gpuTimingEnabled: gpuEnabled && graphics.supported,
        // The owned scene has no temporal accumulation pass or history buffer.
        temporalEnabled: false,
        temporalHistoryValid: null,
        temporalHistoryAgeFrames: null,
        temporalHistoryResetReason: null,
      };
      monitor.endFrame(cpuMs, submissionMs);
      graphics.endFrame(currentId, "complete");
      if (at - lastStats >= 250) {
        lastStats = at;
        const gpu = latest ?? pending;
        const ready = gpu?.invocations.filter((pass) => pass.state === "timed").length ?? 0;
        onStats({
          frames: currentId,
          cpuMs,
          submissionMs,
          drawCalls,
          triangles,
          width,
          height,
          gpuEnabled,
          loadingPhase: loading.phase,
          gpuStatus: !gpuEnabled
            ? "GPU timing disabled"
            : !graphics.supported
              ? "GPU timing unsupported"
              : !gpu
                ? "Waiting for GPU queries"
                : paused
                  ? "Workload paused"
                  : `${ready}/${gpu.invocations.length} GPU passes timed · f${gpu.frameId}`,
        });
      }
      if (!halted) request = requestAnimationFrame(frame);
    } catch (error) {
      fail(error instanceof Error ? error.message : "The scene stopped unexpectedly.");
    }
  };
  resize();
  frame();
  return {
    supported: graphics.supported,
    comparison,
    async loadExample(missing = false) {
      if (stopped || halted) throw new Error("The renderer has stopped");
      monitor.event(
        "Asset preparation",
        missing
          ? "Requested missing asset check"
          : "Requested load and compile on the existing renderer",
      );
      const result = await loading.load(missing);
      if (!stopped) {
        monitor.event("Asset preparation result", result);
        panel.refresh(performance.now(), true);
      }
      return result;
    },
    cancelLoading() {
      loading.cancel();
      if (!stopped) panel.refresh(performance.now(), true);
    },
    setSettings(next: StressSettings) {
      if (
        !Number.isFinite(next.cpuMs) ||
        next.cpuMs < 0 ||
        next.cpuMs > 24 ||
        !Number.isInteger(next.instances) ||
        next.instances < 1 ||
        next.instances > 2048 ||
        !Number.isInteger(next.passes) ||
        next.passes < 1 ||
        next.passes > 8 ||
        !Number.isFinite(next.resolution) ||
        next.resolution < 0.5 ||
        next.resolution > 2
      )
        throw new RangeError("Stress settings are outside the playground limits.");
      applySettings(next);
    },
    setPaused(value: boolean) {
      paused = value;
      spike = false;
      monitor.event(value ? "Workload paused" : "Workload resumed");
    },
    setGpuEnabled,
    setInstancesVisible(visible: boolean) {
      if (stopped || halted || mesh.visible === visible) return;
      mesh.visible = visible;
      monitor.event(visible ? "Instanced mesh shown" : "Instanced mesh hidden");
    },
    injectSpike() {
      if (!paused) {
        spike = true;
        monitor.event("CPU spike", "80 ms synthetic workload queued");
      }
    },
    injectError(kind: "shader" | "validation") {
      if (stopped || halted) return;
      if (graphics.injectError) graphics.injectError(kind);
      else if (kind === "shader") {
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = `#error JANK_INJECTED_SHADER_ERROR\n${shader.fragmentShader}`;
        };
        material.needsUpdate = true;
        paused = false;
      }
    },
    stop,
  };
}
