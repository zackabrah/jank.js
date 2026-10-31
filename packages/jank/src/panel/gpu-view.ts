import type { GpuIntervalSample, GpuSample, GpuState } from "../core/gpu.ts";
import { element, milliseconds, write } from "./dom.ts";
import { createGpuPassRows, type GpuPassRow } from "./gpu-pass-rows.ts";
import { createMeter, meterRows, updateMeter } from "./meters.ts";

/** Row identity and availability belong to this mounted panel, never the recorded measurements. */
export function createGpuView(root: HTMLElement, passOrder?: readonly string[]) {
  const model = createGpuPassRows(passOrder);
  const list = element<HTMLElement>(root, '[data-list="gpu"]');
  const explanation = element<HTMLElement>(root, "[data-gpu-explanation]");
  const legend = element<HTMLElement>(root, '[data-value="gpu-rows-note"]');
  const totals = root.ownerDocument.createElement("div");
  const passes = root.ownerDocument.createElement("div");
  const nodes = new Map<string, PassNode>();
  let measurement: GpuSample["measurement"] | null = null;
  list.replaceChildren(totals, passes);
  function clear(): void {
    model.clear();
    measurement = null;
    nodes.clear();
    passes.replaceChildren();
  }
  return {
    clear,
    render(gpu: GpuState | null, budgetMs: number): void {
      const view = model.update(gpu);
      const sample = gpu?.status === "ready" ? gpu.sample : null;
      explanation.hidden = view.measurement !== "intervals";
      renderTotals(totals, view.measurement, sample, budgetMs);
      if (measurement !== view.measurement) {
        nodes.clear();
        passes.replaceChildren();
        measurement = view.measurement;
      }
      renderPassRows(passes, nodes, view.rows, budgetMs);
      legend.hidden = view.rows.length === 0;
      write(
        root,
        "gpu-rows-note",
        "Dimmed rows lack observations in this sample. — means no timing; hover for the reason." +
          (view.hiddenPasses > 0
            ? ` ${view.hiddenPasses} current passes are not displayed: the 256-row limit is full. CLEAR resets remembered rows.`
            : ""),
      );
      write(root, "gpu-note", gpuDescription(gpu));
    },
  };
}

interface PassNode {
  readonly element: HTMLElement;
  readonly value: Text;
  readonly status: HTMLElement;
  readonly meter: HTMLElement;
}

function renderPassRows(
  parent: HTMLElement,
  nodes: Map<string, PassNode>,
  values: readonly GpuPassRow[],
  budgetMs: number,
): void {
  let next = parent.firstElementChild;
  for (const row of values) {
    let node = nodes.get(row.key);
    if (!node) {
      node = createPassNode(parent.ownerDocument, row);
      nodes.set(row.key, node);
    }
    if (node.element !== next) {
      parent.insertBefore(node.element, next);
    }
    next = node.element.nextElementSibling;
    node.element.dataset.observation = row.status;
    updateMeter(node.meter, row.durationMs, budgetMs);
    const description = rowDescription(row);
    node.element.title =
      description +
      (row.durationMs === null
        ? ""
        : ` · ${row.durationMs.toFixed(2)} ms · ${((row.durationMs / budgetMs) * 100).toFixed(1)}% of budget`);
    const value = milliseconds(row.durationMs, 2);
    if (node.value.data !== value) {
      node.value.data = value;
    }
    if (node.status.textContent !== description) {
      node.status.textContent = description;
    }
  }
}

function createPassNode(document: Document, row: GpuPassRow): PassNode {
  const element = document.createElement("div");
  element.className = "jank-row jank-meter-row jank-gpu-pass";
  element.dataset.passId = row.id;
  const label = document.createElement("span");
  label.textContent = [row.label, row.type, row.category, `#${row.occurrence}`]
    .filter(Boolean)
    .join(" · ");
  const cell = document.createElement("span");
  const value = document.createTextNode("");
  const status = document.createElement("span");
  status.className = "jl-sr";
  cell.append(value, status);
  const meter = createMeter(document);
  element.append(label, meter, cell);
  return { element, value, status, meter };
}

function renderTotals(
  root: HTMLElement,
  measurement: GpuSample["measurement"] | null,
  sample: GpuSample | null,
  budgetMs: number,
): void {
  if (measurement === "intervals") {
    const metrics = sample?.measurement === "intervals" ? sample.metrics : null;
    const totals: readonly (readonly [string, number | null])[] = [
      ["Render pass sum", metrics?.renderSumMs ?? null],
      ["Compute pass sum", metrics?.computeSumMs ?? null],
      ["Combined pass sum", metrics?.combinedSumMs ?? null],
      ["GPU busy (union)", metrics?.busyMs ?? null],
      ["GPU elapsed span", metrics?.elapsedSpanMs ?? null],
    ];
    meterRows(
      root,
      totals.map(([label, durationMs]) => ({
        label,
        durationMs,
        description: `${label}: ${milliseconds(durationMs, 2)} ms. GPU totals are separate measures; do not add them together.`,
      })),
      budgetMs,
    );
    return;
  }
  const duration = sample && sample.measurement !== "intervals" ? sample.durationMs : null;
  meterRows(
    root,
    [
      {
        label: measurement ?? "GPU time",
        durationMs: duration,
        description: "Asynchronous GPU timing; separate from CPU execution.",
      },
    ],
    budgetMs,
  );
}

function rowDescription(row: GpuPassRow): string {
  if (row.status === "not-observed") {
    return "Not observed in this sample";
  }
  if (row.status === "unavailable") {
    return "GPU sample unavailable";
  }
  if (row.status === "rejected") {
    return `Rejected timestamp: ${row.reason}`;
  }
  return row.durationMs === null ? "Observed; timing unavailable" : "Observed in this sample";
}

function gpuDescription(gpu: GpuState | null): string {
  if (gpu?.status === "ready") {
    const sample = gpu.sample;
    if (sample.measurement === "intervals") {
      return intervalStatus(gpu, sample);
    }
    return `Renderer frame ${sample.rendererFrameId}; age ${gpu.currentRendererFrameId - sample.rendererFrameId} frames. ${gpu.droppedSamples} dropped samples; ${sample.omittedPasses} omitted passes.`;
  }
  if (gpu?.status === "unsupported") {
    return `unsupported · ${gpu.reason}`;
  }
  if (gpu?.status === "error") {
    return `error · ${gpu.message}`;
  }
  return gpu?.status ?? "No GPU source connected.";
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
