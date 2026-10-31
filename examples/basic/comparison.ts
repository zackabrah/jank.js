import type { GpuState, Profiler } from "../../packages/jank/src/index.ts";
import {
  type ComparisonRun,
  type ComparisonSettings,
  createComparisonRun,
  summarizeComparison,
} from "./comparison-run.ts";
import type { createDemoGpu, DemoGpuMode } from "./gpu-source.ts";
import type { createScene } from "./scene.ts";

interface ComparisonHost {
  readonly scene: ReturnType<typeof createScene> | null;
  readonly gpu: ReturnType<typeof createDemoGpu>;
  readonly canvas: HTMLCanvasElement;
  readonly profiler: () => Profiler | null;
  readonly canStart: () => boolean;
  readonly settings: () => ComparisonSettings;
}
function required<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing comparison control: ${id}`);
  }
  // These IDs and their native element types are owned by the demo HTML.
  return found as T;
}
function readSettings(variant: "a" | "b"): ComparisonSettings {
  return {
    objects: Number(required<HTMLSelectElement>(`comparison-${variant}-objects`).value),
    cpuMs: Number(required<HTMLSelectElement>(`comparison-${variant}-cpu`).value),
    scale: Number(required<HTMLSelectElement>(`comparison-${variant}-scale`).value),
    animate: required<HTMLInputElement>(`comparison-${variant}-animate`).checked,
  };
}
const ms = (value: number | null | undefined) =>
  value == null ? "unknown" : `${value.toFixed(2)} ms`;

/** Owns demo controls and restoration; measurement advances only from the existing host loop. */
export function createComparison(host: ComparisonHost) {
  const form = required<HTMLFormElement>("comparison-form");
  const startButton = required<HTMLButtonElement>("comparison-start");
  const stopButton = required<HTMLButtonElement>("comparison-stop");
  const exportButton = required<HTMLButtonElement>("comparison-export");
  const status = required("comparison-status");
  const contextLabel = required("comparison-context");
  const summary = required("comparison-summary");
  const trialList = required("comparison-trials");
  const disabled = new Map<HTMLButtonElement | HTMLInputElement | HTMLSelectElement, boolean>();
  let run: ComparisonRun | null = null;
  let active = false;
  let trialIndex = -1;
  let original: ComparisonSettings | null = null;
  let currentSettings: ComparisonSettings | undefined;
  let originalTime = 0;
  let originalGpu: DemoGpuMode = "webgl2";
  let viewport = { width: 0, height: 0, pixelRatio: 0 };
  let context: ReturnType<typeof describeContext> | null = null;
  let lastExportUrl: string | null = null;
  let renderedTrials = -1;
  let renderedStatus = "";

  function restore(): void {
    if (!active || !original) {
      return;
    }
    active = false;
    host.scene?.clearStress(original.objects);
    host.scene?.setResolutionScale(original.scale);
    host.scene?.setAnimationTime(originalTime);
    host.gpu.select(originalGpu);
    for (const [control, wasDisabled] of disabled) {
      control.disabled = wasDisabled;
    }
    disabled.clear();
  }
  function cancel(reason: string): void {
    run?.cancel(reason);
    restore();
    refresh();
  }
  function lockControls(): void {
    for (const control of disabled.keys()) {
      control.disabled = true;
    }
  }
  function refresh(): void {
    if (active && host.profiler()?.snapshot().targetFps !== run?.report().options.targetFps) {
      cancel("Jank budget changed; restart the comparison.");
      return;
    }
    startButton.disabled = active || !host.scene || !host.profiler() || !host.canStart();
    stopButton.disabled = !active;
    exportButton.disabled = active || !run;
    if (active) {
      lockControls();
    }
    if (!run) {
      return;
    }
    const progress = run.progress();
    const report = run.report();
    status.textContent = active
      ? `Running pair ${progress.pair}/${report.options.pairs} · ${progress.variant} · ${progress.stage} · ${(progress.elapsedMs / 1000).toFixed(0)} s`
      : report.reason;
    if (renderedTrials !== report.trials.length || renderedStatus !== report.status) {
      renderedStatus = report.status;
      renderedTrials = report.trials.length;
      renderReport();
    }
  }
  function applyTrial(): void {
    if (!run || !host.scene || !context) {
      return;
    }
    const progress = run.progress();
    if (trialIndex === progress.index) {
      return;
    }
    trialIndex = progress.index;
    const settings = run.settings();
    currentSettings = settings;
    host.scene.clearStress(settings.objects);
    host.scene.setResolutionScale(settings.scale);
    host.scene.setAnimationTime(0);
    context.trials.push({
      pair: progress.pair,
      variant: progress.variant,
      settings,
      drawingWidth: host.canvas.width,
      drawingHeight: host.canvas.height,
    });
  }
  function start(event: SubmitEvent): void {
    event.preventDefault();
    const profiler = host.profiler();
    if (active || !profiler || !host.scene || !host.canStart()) {
      return;
    }
    if (profiler.capture.getState().status !== "idle") {
      status.textContent = "Stop or disarm the current recording before comparing.";
      return;
    }
    try {
      run = createComparisonRun({
        a: readSettings("a"),
        b: readSettings("b"),
        targetFps: profiler.snapshot().targetFps,
        pairs: required<HTMLInputElement>("comparison-pairs").valueAsNumber,
        warmupMs: required<HTMLInputElement>("comparison-warmup").valueAsNumber * 1000,
        measureMs: required<HTMLInputElement>("comparison-measure").valueAsNumber * 1000,
        startedAtMs: performance.now(),
      });
      original = host.settings();
      originalTime = host.scene.animationTime();
      originalGpu = host.gpu.mode();
      viewport = {
        width: host.canvas.clientWidth,
        height: host.canvas.clientHeight,
        pixelRatio: devicePixelRatio,
      };
      context = describeContext(profiler, viewport);
      trialIndex = -1;
      renderedTrials = -1;
      for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >(
        ".demo-controls button, .demo-controls input, .demo-controls select, #panel-mount button, #panel-mount input, #panel-mount select",
      )) {
        if (control !== stopButton) {
          disabled.set(control, control.disabled);
        }
      }
      active = true;
      host.gpu.select("webgl2");
      host.gpu.reset();
      applyTrial();
      const options = run.report().options;
      contextLabel.textContent = `${options.targetFps} FPS · ${(1000 / options.targetFps).toFixed(2)} ms budget · ${viewport.width} × ${viewport.height} CSS px · ${options.pairs} pairs · ${options.warmupMs / 1000} s warm-up + ${options.measureMs / 1000} s measurement + 0.5 s GPU drain per trial.`;
      refresh();
      stopButton.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start comparison.";
      cancel(message);
      status.textContent = message;
    }
  }
  function beforeFrame(atMs: number): void {
    if (!active || !run) {
      return;
    }
    if (
      host.canvas.clientWidth !== viewport.width ||
      host.canvas.clientHeight !== viewport.height ||
      devicePixelRatio !== viewport.pixelRatio
    ) {
      cancel("Viewport changed; restart with a fixed resolution.");
      return;
    }
    if (host.gpu.mode() !== "webgl2" || host.scene?.context.isContextLost()) {
      cancel("GPU source changed or context lost; restart the comparison.");
      return;
    }
    run.tick(atMs);
    if (!run.running()) {
      restore();
      refresh();
      return;
    }
    applyTrial();
  }
  function renderReport(): void {
    if (!run) {
      return;
    }
    const report = run.report();
    const metrics = summarizeComparison(report);
    summary.replaceChildren();
    for (const [label, metric] of Object.entries(metrics)) {
      const entry = document.createElement("p");
      entry.textContent = metric
        ? `${label.toUpperCase()} p95: A ${ms(metric.aMs)}, B ${ms(metric.bMs)}. Paired B − A ${ms(metric.deltaMs)} (${metric.deltaPercent?.toFixed(1) ?? "unknown"}%). A range ${metric.aRangeMs.map(ms).join(" to ")}; B range ${metric.bRangeMs.map(ms).join(" to ")}. Paired difference range ${metric.pairedDeltaRangeMs.map(ms).join(" to ")}.`
        : `${label.toUpperCase()} comparison: unknown — requires all paired trials with enough valid samples.`;
      summary.append(entry);
    }
    trialList.replaceChildren();
    for (const trial of report.trials) {
      const entry = document.createElement("li");
      entry.textContent = `Pair ${trial.pair} / ${trial.variant} · ${trial.frames} frames, ${(trial.windowCoverage * 100).toFixed(0)}% of measurement window. p95 CPU ${ms(trial.cpu?.p95Ms)}, GPU ${ms(trial.gpu?.p95Ms)}, frame ${ms(trial.frame?.p95Ms)}. GPU coverage ${(trial.gpuCoverage * 100).toFixed(0)}% (${trial.gpuSamples}/${trial.frames}). Over budget: CPU ${percent(trial.cpu?.overBudgetPercent)}, GPU ${percent(trial.gpu?.overBudgetPercent)}, pacing ${percent(trial.frame?.overBudgetPercent)}.`;
      trialList.append(entry);
    }
  }
  function exportReport(): void {
    if (!run || active) {
      return;
    }
    const report = run.report();
    if (lastExportUrl) {
      URL.revokeObjectURL(lastExportUrl);
    }
    lastExportUrl = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "jank-demo-comparison",
              version: 1,
              ...report,
              context,
              summary: summarizeComparison(report),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = lastExportUrl;
    link.download = "jank-ab-comparison.json";
    link.click();
  }
  const stop = () =>
    cancel("Stopped by user. Only completed trials are retained; no comparison conclusion.");
  const visibility = () => {
    if (active && document.hidden) {
      cancel("Tab hidden; restart in the foreground.");
    }
  };
  form.addEventListener("submit", start);
  stopButton.addEventListener("click", stop);
  exportButton.addEventListener("click", exportReport);
  document.addEventListener("visibilitychange", visibility);
  refresh();
  return {
    active: () => active,
    settings: () => (active ? currentSettings : undefined),
    beforeFrame,
    frame: (frame: { frameId: number; atMs: number; cpuMs: number }) => {
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
      form.removeEventListener("submit", start);
      stopButton.removeEventListener("click", stop);
      exportButton.removeEventListener("click", exportReport);
      document.removeEventListener("visibilitychange", visibility);
      if (lastExportUrl) {
        URL.revokeObjectURL(lastExportUrl);
      }
    },
  };
}
function percent(value: number | undefined): string {
  return value === undefined ? "unknown" : `${value.toFixed(1)}%`;
}
function describeContext(
  profiler: Profiler,
  viewport: { width: number; height: number; pixelRatio: number },
) {
  const snapshot = profiler.snapshot();
  return {
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    viewport: { ...viewport },
    gpu: "WebGL2 elapsed scene render",
    scene: "Basic demo cubes and grid; shared geometry and materials; no external assets",
    animation: "Reset to time zero before each warm-up; host delta capped at 50 ms",
    panelMode:
      document.querySelector("#panel-mount .jank")?.getAttribute("data-mode") ?? "detached",
    scopesRequested: snapshot.scopesRequested,
    traceEnabled: snapshot.traceEnabled,
    trials: [] as {
      pair: number;
      variant: string;
      settings: ComparisonSettings;
      drawingWidth: number;
      drawingHeight: number;
    }[],
    limits:
      "Quick observations, not statistical significance or thermal guarantees. CPU excludes panel refresh, browser paint and GPU execution. Frame pacing includes the host loop. CPU and GPU overlap. All metrics need 80% of the requested time window in sealed frames. GPU also needs 80% sample coverage and 20 valid samples. Pacing budget allows 1 ms or 5% tolerance. Summary uses medians of trial p95 values and paired differences; negative B−A is lower time.",
  };
}
