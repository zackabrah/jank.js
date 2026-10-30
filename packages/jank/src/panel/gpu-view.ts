import type { GpuIntervalSample, GpuState } from "../core/gpu.ts";
import { element, milliseconds, rows, write } from "./dom.ts";

export function renderGpu(root: HTMLElement, gpu: GpuState | null): void {
  const list = element<HTMLElement>(root, '[data-list="gpu"]');
  const explanation = element<HTMLElement>(root, "[data-gpu-explanation]");
  explanation.hidden = gpu?.status !== "ready" || gpu.sample.measurement !== "intervals";
  if (gpu?.status === "ready") {
    if (gpu.sample.measurement === "intervals") {
      rows(list, intervalRows(gpu.sample));
      const age = (gpu.currentFrameSequence ?? gpu.sample.sequence) - gpu.sample.sequence;
      const freshness = age > 2 ? "stale" : "ready";
      write(
        root,
        "gpu-note",
        `${freshness} · ${gpu.sample.completeness}; application frame ${gpu.sample.frameId ?? "unassociated"}; age ${age} application frames. ${gpu.pendingFrames ?? 0} pending; ${gpu.droppedSamples} dropped samples; ${gpu.sample.omittedPasses} omitted passes. ${gpu.sample.issues.join(", ")}`,
      );
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
