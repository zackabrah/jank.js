import {
  createComparison,
  createPanel,
  createProfiler,
  type GpuIntervalPass,
  type GpuState,
  type LoadingSnapshot,
  type PanelMode,
} from "../../packages/jank/src/index.ts";
import { createDiagnosticPreview } from "./diagnostic-preview.ts";

/** Synthetic observations exercise real UI states without benchmarking the user's machine. */
export function createProfilerPreview(containers: Record<PanelMode, HTMLElement>) {
  const diagnostics = createDiagnosticPreview();
  let clockMs = 0;
  let boundaryMs = 0;
  let sequence = 0;
  let refreshMs = 0;
  let gpuExample = "valid";
  let gpuEnabled = true;
  let gpuState: GpuState = { status: "pending" };
  let traceEvents = 0;
  const profiler = createProfiler({
    now: () => clockMs,
    targetFps: 60,
    application: { name: "UI library — SIMULATED DATA" },
    trace: {
      writeScope: () => {
        traceEvents += 1;
      },
      writeEvent: () => {
        traceEvents += 1;
      },
    },
  });
  const simulation = profiler.createChannel({
    id: "simulation",
    label: "Simulation",
    readCounters: () => ({ objects: 2400, triangles: 1280000, traceEvents }),
  });
  const rendering = profiler.createChannel({
    id: "render",
    label: "Render submission",
    readCounters: () => ({ calls: 128, memoryBytes: 67108864, animations: true }),
  });
  const loading: LoadingSnapshot = {
    id: 1,
    label: "Simulated scene loading",
    kind: "fresh-context",
    status: "ready",
    elapsedMs: 412,
    pendingOperations: 0,
    stages: [
      {
        name: "Textures",
        operationCount: 8,
        failedCount: 0,
        cancelledCount: 0,
        totalMs: 680,
        busyMs: 320,
        receivedBytes: 8388608,
        cache: { hits: 2, misses: 6, inFlight: 0 },
      },
      {
        name: "Pipeline compilation",
        operationCount: 12,
        failedCount: 0,
        cancelledCount: 0,
        totalMs: 152,
        busyMs: 92,
        receivedBytes: 0,
        cache: { hits: 0, misses: 12, inFlight: 0 },
      },
    ],
  };
  let comparisonCpuScale = 1;
  const comparison = createComparison({
    profiler,
    host: {
      begin: () => ({
        apply: (variant) => {
          comparisonCpuScale = variant === "A" ? 1 : 1.25;
          return {
            label: `SIMULATED comparison ${variant}`,
            settings: [{ label: "Synthetic CPU scale", value: comparisonCpuScale }],
            resolution: null,
            animation: "Synthetic stream; not a device benchmark",
          };
        },
        restore: () => {
          comparisonCpuScale = 1;
        },
      }),
    },
  });
  const panels = (["full", "mini", "line"] as const).map((mode) => {
    const panel = createPanel({
      container: containers[mode],
      profiler,
      comparison,
      mode,
      gpuPassOrder: ["panorama", "ocean", "resolve"],
      gpu: {
        label: "SIMULATED showcase GPU",
        read: () => gpuState,
        setEnabled: (enabled) => {
          gpuEnabled = enabled;
          gpuState = enabled ? { status: "pending" } : { status: "disabled" };
          profiler.observeGpu(gpuState);
        },
      },
      ...diagnostics,
      loading: { snapshot: () => loading, history: () => [loading] },
    });
    // This gallery mounts three copies; their landmarks need distinct accessible names.
    containers[mode].querySelector(".jank")?.setAttribute("aria-label", `Jank ${mode} preview`);
    panel.setMode(mode);
    return panel;
  });

  function step(durationMs = 16 + Math.sin(sequence / 19) * 2): void {
    boundaryMs += durationMs;
    clockMs = boundaryMs;
    const frameId = profiler.beginFrame(boundaryMs);
    comparison.tick(boundaryMs, frameId);
    sequence += 1;
    const updateMs = (2.6 + Math.sin(sequence / 13) * 0.9) * comparisonCpuScale;
    const renderMs = 3.8 + Math.cos(sequence / 17) * 1.1;
    const updateToken = simulation.begin();
    clockMs += updateMs;
    simulation.end(updateToken);
    const renderToken = rendering.begin();
    clockMs += renderMs;
    rendering.end(renderToken);
    profiler.endFrame({ updateMs, renderMs });
    gpuState = gpuEnabled ? sampleGpu(frameId, sequence, gpuExample) : { status: "disabled" };
    profiler.observeGpu(gpuState);
  }

  function refresh(force = false): void {
    refreshMs += force ? 1000 : 1000 / 60;
    for (const panel of panels) {
      panel.refresh(refreshMs);
    }
  }

  profiler.capture.start();
  for (let index = 0; index < 150; index += 1) {
    step(index === 100 ? 32 : undefined);
    if (index === 104) {
      profiler.addEvent("Sample event", "A simulated scene change.");
    }
  }
  profiler.capture.stop();
  refresh(true);

  return {
    tick: () => {
      step();
      refresh();
    },
    setGpuExample: (value: string) => {
      comparison.cancel("GPU example changed; restart the simulated comparison.");
      gpuExample = value;
      gpuEnabled = true;
      step();
      refresh(true);
    },
    spike: () => {
      comparison.cancel("Sample spike requested; comparison cancelled.");
      step(48);
      profiler.addEvent("Sample spike", "Synthetic 48 ms frame.");
      step();
      refresh(true);
    },
    marker: () => {
      profiler.addEvent("Sample marker", "Added from the standalone library.");
      refresh(true);
    },
    dispose: () => {
      for (const panel of panels) {
        panel.dispose();
      }
      comparison.dispose();
      profiler.dispose();
    },
  };
}

function sampleGpu(frameId: number, sequence: number, example: string): GpuState {
  if (example === "pending") {
    return { status: "pending" };
  }
  if (example === "unsupported") {
    return { status: "unsupported", reason: "Simulated device without timestamp queries." };
  }
  if (example === "error") {
    return { status: "error", message: "Simulated readback failure. Timing is unknown." };
  }
  return readyGpu(frameId, sequence, example);
}

function readyGpu(frameId: number, sequence: number, example: string): GpuState {
  const passes: GpuIntervalPass[] = [
    {
      id: "panorama",
      label: "Cloud panorama",
      type: "render",
      category: "environment",
      invocation: 1,
      rendererFrameId: sequence,
      startNs: 0,
      endNs: 3200000,
    },
    {
      id: "ocean",
      label: "Ocean FFT",
      type: "compute",
      category: "water",
      invocation: 2,
      rendererFrameId: sequence,
      startNs: 3200000,
      endNs: 5300000,
    },
    {
      id: "resolve",
      label: "Temporal resolve",
      type: "render",
      category: "post",
      invocation: example === "missing" ? 2 : 3,
      rendererFrameId: sequence,
      startNs: 5300000,
      endNs: 6500000,
    },
  ];
  const rejected = example === "rejected";
  const missing = example === "missing";
  const retained = missing || rejected ? passes.filter((pass) => pass.id !== "ocean") : passes;
  return {
    status: "ready",
    currentRendererFrameId: sequence,
    droppedSamples: 0,
    sample: {
      measurement: "intervals",
      frameId,
      rendererFrameId: sequence,
      sequence,
      clock: {
        id: "simulated-gpu",
        domain: "webgpu-timestamp",
        unit: "nanoseconds",
        originNs: "1000000000",
      },
      passes: retained,
      rejectedPasses: rejected
        ? [
            {
              id: "ocean",
              label: "Ocean FFT",
              type: "compute",
              category: "water",
              invocation: 2,
              rendererFrameId: sequence,
              reason: "zero-timestamp",
              startNs: "0",
              endNs: "0",
            },
          ]
        : [],
      expectedPasses: missing ? 2 : 3,
      omittedPasses: rejected ? 1 : 0,
      completeness: rejected ? "incomplete" : "complete",
      issues: rejected ? ["zero-timestamp"] : [],
      metrics: rejected
        ? null
        : {
            renderSumMs: 4.4,
            computeSumMs: missing ? 0 : 2.1,
            combinedSumMs: missing ? 4.4 : 6.5,
            busyMs: missing ? 4.4 : 6.5,
            elapsedSpanMs: 6.5,
          },
    },
  };
}
