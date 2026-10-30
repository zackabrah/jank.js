import type { GpuIntervalSample, GpuState } from "../core/gpu.ts";
import { element, milliseconds, rows, write } from "./dom.ts";

export function renderGpu(root: HTMLElement, gpu: GpuState | null): void {
  const list = element<HTMLElement>(root, '[data-list="gpu"]');
  const explanation = element<HTMLElement>(root, "[data-gpu-explanation]");
  explanation.hidden = gpu?.status !== "ready" || gpu.sample.measurement !== "intervals";
  if (gpu?.status === "ready") {
    if (gpu.sample.measurement === "intervals") {
      rows(list, intervalRows(gpu.sample));
      write(root, "gpu-note", intervalStatus(gpu, gpu.sample));
    } else {
      rows(list, [
        [gpu.sample.measurement, milliseconds(gpu.sample.durationMs, 2)],
        ...gpu.sample.passes.map((pass): [string, string] => [
          pass.label,
          milliseconds(pass.durationMs, 2),
        ]),
      ]);
      write(
        root,
        "gpu-note",
        `Renderer frame ${gpu.sample.rendererFrameId}; age ${gpu.currentRendererFrameId - gpu.sample.rendererFrameId} frames. ${gpu.droppedSamples} dropped samples; ${gpu.sample.omittedPasses} omitted passes.`,
      );
    }
    return;
  }
  rows(list, [["GPU time", "–"]]);
  let description = gpu?.status ?? "No GPU source connected.";
  if (gpu?.status === "unsupported") {
    description = `unsupported · ${gpu.reason}`;
  } else if (gpu?.status === "error") {
    description = `error · ${gpu.message}`;
  }
  write(root, "gpu-note", description);
}

function intervalStatus(
  gpu: Extract<GpuState, { status: "ready" }>,
  sample: GpuIntervalSample,
): string {
  const age =
    gpu.currentFrameSequence === undefined ? null : gpu.currentFrameSequence - sample.sequence;
  const freshness = age !== null && age > 2 ? "stale" : "ready";
  const ageText = age === null ? "age unavailable" : `age ${age} application frames`;
  const pendingText =
    gpu.pendingFrames === undefined ? "pending count unavailable" : `${gpu.pendingFrames} pending`;
  return `${freshness} · ${sample.completeness}; application frame ${sample.frameId ?? "unassociated"}; ${ageText}. ${pendingText}; ${gpu.droppedSamples} dropped samples; ${sample.omittedPasses} omitted passes. ${sample.issues.join(", ")}`;
}

function intervalRows(sample: GpuIntervalSample): [string, string][] {
  const metrics = sample.metrics;
  return [
    ["Render pass sum", milliseconds(metrics?.renderSumMs, 2)],
    ["Compute pass sum", milliseconds(metrics?.computeSumMs, 2)],
    ["Combined pass sum", milliseconds(metrics?.combinedSumMs, 2)],
    ["GPU busy (union)", milliseconds(metrics?.busyMs, 2)],
    ["GPU elapsed span", milliseconds(metrics?.elapsedSpanMs, 2)],
    ...sample.passes.map((pass): [string, string] => [
      [pass.label, pass.type, pass.category, `#${pass.invocation}`].filter(Boolean).join(" · "),
      milliseconds((pass.endNs - pass.startNs) / 1e6, 2),
    ]),
  ];
}
