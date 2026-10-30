import type { GpuState, Profiler } from "../../packages/jank/src/index.ts";
import type { createDemoGpu, DemoGpuMode } from "./gpu-source.ts";
import { baselineSummary, loadLabel, phaseSummary } from "./headroom-results.ts";
import { createHeadroomRun, type HeadroomFrame, type HeadroomRun } from "./headroom-run.ts";
import { createCpuProbe } from "./headroom-workloads.ts";
import type { createScene } from "./scene.ts";

interface HeadroomHost {
  readonly scene: ReturnType<typeof createScene> | null;
  readonly gpu: ReturnType<typeof createDemoGpu>;
  readonly profiler: () => Profiler | null;
  readonly canStart: () => boolean;
  readonly canvas: HTMLCanvasElement;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing headroom control: ${id}`);
  }
  // IDs and types are defined by this demo's static markup.
  return element as T;
}

/** Coordinates only the demo; the host retains its sole animation loop and profiler. */
export function createHeadroomTest(host: HeadroomHost) {
  const startButton = required<HTMLButtonElement>("headroom-start");
  const stopButton = required<HTMLButtonElement>("headroom-stop");
  const status = required("headroom-status");
  const context = required("headroom-context");
  const results = required("headroom-results");
  const baseline = required("headroom-baseline");
  const cpu = required("headroom-cpu");
  const gpu = required("headroom-gpu");
  const scene = required("headroom-scene");
  const controls = [
    ...document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      ".demo-controls button, .demo-controls input, .demo-controls select",
    ),
  ].filter((control) => !control.id.startsWith("headroom-"));
  const disabled = new Map<(typeof controls)[number], boolean>();
  const compute = createCpuProbe();
  let run: HeadroomRun | null = null;
  let active = false;
  let originalObjects = 36;
  let originalGpu: DemoGpuMode = "webgl2";
  let width = 0;
  let height = 0;
  let cpuBatches = 0;

  function restore(): void {
    if (!active) {
      return;
    }
    active = false;
    cpuBatches = 0;
    host.scene?.clearStress(originalObjects);
    host.gpu.select(originalGpu);
    for (const [control, wasDisabled] of disabled) {
      control.disabled = wasDisabled;
    }
    disabled.clear();
  }

  function refresh(): void {
    if (active && host.profiler()?.snapshot().targetFps !== run?.report().targetFps) {
      cancel("Jank budget changed; restart to measure the new budget.");
      return;
    }
    startButton.disabled = active || !host.scene || !host.profiler() || !host.canStart();
    stopButton.disabled = !active;
    if (active) {
      for (const control of controls) {
        control.disabled = true;
      }
    }
    const report = run?.report();
    if (!report) {
      return;
    }
    results.hidden = false;
    status.textContent =
      report.status === "running"
        ? `Running ${report.level.phase}: ${loadLabel(report.level.phase, report.level.amount)} · ${Math.floor(report.elapsedMs / 1000)} / 60 s`
        : report.reason;
    baseline.textContent = baselineSummary(report);
    cpu.textContent = phaseSummary(report, "cpu");
    gpu.textContent = phaseSummary(report, "gpu");
    scene.textContent = phaseSummary(report, "scene");
  }

  function start(): void {
    const profiler = host.profiler();
    if (active || !profiler || !host.scene || !host.canStart()) {
      return;
    }
    originalObjects = host.scene.counters().objects;
    originalGpu = host.gpu.mode();
    host.gpu.select("webgl2");
    host.gpu.reset();
    width = host.canvas.width;
    height = host.canvas.height;
    const targetFps = profiler.snapshot().targetFps;
    run = createHeadroomRun({
      targetFps,
      objects: originalObjects,
      startedAtMs: performance.now(),
      gpuSupported: host.gpu.source.read().status !== "unsupported",
    });
    for (const control of controls) {
      disabled.set(control, control.disabled);
    }
    active = true;
    context.textContent = `Jank: ${targetFps} FPS · ${(1000 / targetFps).toFixed(2)} ms each for CPU / GPU · ${width} × ${height} drawing pixels · ${originalObjects} baseline cubes.`;
    refresh();
  }

  function cancel(reason: string): void {
    run?.cancel(reason);
    restore();
    refresh();
  }

  function beforeFrame(atMs: number): void {
    if (!active || !run) {
      return;
    }
    if (host.canvas.width !== width || host.canvas.height !== height) {
      cancel("Viewport changed; restart at the new resolution.");
      return;
    }
    if (host.gpu.mode() !== "webgl2" || host.scene?.context.isContextLost()) {
      cancel("GPU source changed or context lost; restart the estimate.");
      return;
    }
    run.tick(atMs);
    if (!run.running()) {
      restore();
      refresh();
      return;
    }
    const work = run.work();
    cpuBatches = work.cpuBatches;
    host.scene?.setCount(work.objects);
    host.scene?.stressGpu(work.gpuIterations);
  }

  const stop = () =>
    cancel("Stopped by user. Completed steps are retained; unfinished limits remain unknown.");
  const visibility = () => {
    if (document.hidden && active) {
      cancel("Tab hidden; restart in the foreground.");
    }
  };
  startButton.addEventListener("click", start);
  stopButton.addEventListener("click", stop);
  document.addEventListener("visibilitychange", visibility);
  refresh();
  return {
    active: () => active,
    beforeFrame,
    compute: () => compute(cpuBatches),
    frame: (frame: Omit<HeadroomFrame, "gpuMs">) => {
      if (active) {
        run?.frame(frame);
      }
    },
    gpu: (state: GpuState) => {
      if (
        active &&
        state.status === "ready" &&
        state.sample.measurement !== "intervals" &&
        state.sample.frameId !== null &&
        state.sample.durationMs !== null
      ) {
        run?.gpu(state.sample.frameId, state.sample.durationMs);
      }
    },
    refresh,
    cancel,
    dispose: () => {
      run?.cancel("Demo disposed.");
      restore();
      startButton.removeEventListener("click", start);
      stopButton.removeEventListener("click", stop);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
