import { summarizeComparisonTrial } from "../analysis/comparison.ts";
import { summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";
import { inspectFrame } from "../analysis/summary.ts";
import type { ComparisonTrial } from "../comparison/comparison.ts";
import type { GpuSample } from "../core/gpu.ts";
import type { Recording } from "../recordings/recording.ts";
import { element, milliseconds, percent, renderTable, write } from "./dom.ts";

export function renderFrame(
  root: HTMLElement,
  recording: Recording,
  frameId: number | null,
  gpuIndex: number,
): void {
  const frame = recording.frames.find((frame) => frame.id === frameId);
  const cpu = element<HTMLElement>(root, "[data-viewer-cpu]");
  const gpu = element<HTMLElement>(root, "[data-viewer-gpu]");
  const events = element<HTMLElement>(root, "[data-viewer-events]");
  cpu.replaceChildren();
  gpu.replaceChildren();
  events.replaceChildren();
  if (!frame) {
    write(
      root,
      "frame",
      recording.frames.length
        ? "No frame at the selected elapsed time. Timing is unknown."
        : "No sealed frames in this recording.",
    );
    return;
  }
  const inspected = inspectFrame(recording, frame.id);
  write(
    root,
    "frame",
    `Frame #${frame.id} · ${milliseconds(frame.endedAtMs - frame.startedAtMs)} · CPU update ${milliseconds(frame.cpu.updateMs)}, render ${milliseconds(frame.cpu.renderMs)}`,
  );
  const note = root.ownerDocument.createElement("p");
  note.textContent = `Scope coverage: ${frame.coverage.status}. Attributed union ${milliseconds(inspected?.attributedMs)}; unattributed ${milliseconds(inspected?.unattributedMs)} (waiting or unobserved work). Scope rows are inclusive; do not add nested scopes.`;
  cpu.append(note);
  const table = tableContainer(root, "CPU scope intervals");
  renderTable(
    table,
    "CPU scope intervals",
    ["Channel", "Start in frame", "End in frame", "Duration"],
    frame.scopes.map((scope) => [
      recording.channels.find((channel) => channel.id === scope.channelId)?.label ??
        scope.channelId,
      milliseconds(scope.startedAtMs - frame.startedAtMs),
      milliseconds(scope.endedAtMs - frame.startedAtMs),
      milliseconds(scope.endedAtMs - scope.startedAtMs),
    ]),
  );
  cpu.append(table);
  renderGpu(
    gpu,
    recording.gpu.filter((sample) => sample.frameId === frame.id),
    gpuIndex,
  );
  const rows = recording.events
    .filter((event) => event.atMs >= frame.startedAtMs && event.atMs < frame.endedAtMs)
    .map((event) => ["Event", event.label, event.detail ?? "—"]);
  for (const sample of recording.counters.filter(
    (sample) => sample.atMs >= frame.startedAtMs && sample.atMs < frame.endedAtMs,
  )) {
    if (sample.status === "error") {
      rows.push(["Counter error", sample.channelId, sample.message]);
      continue;
    }
    for (const [name, value] of Object.entries(sample.values)) {
      rows.push([sample.channelId, name, value === null ? "Unknown" : String(value)]);
    }
  }
  const eventTable = tableContainer(root, "Frame events and counters");
  renderTable(eventTable, "Frame events and counters", ["Source", "Label", "Value"], rows);
  events.append(eventTable);
}
function tableContainer(root: HTMLElement, label: string): HTMLElement {
  const table = root.ownerDocument.createElement("div");
  table.className = "jank-viewer-table";
  table.tabIndex = 0;
  table.setAttribute("role", "region");
  table.setAttribute("aria-label", label);
  return table;
}
function renderGpu(root: HTMLElement, samples: readonly GpuSample[], selected: number): void {
  const sample = samples[selected];
  if (!sample) {
    root.textContent = "No GPU observation for this frame. Timing is unknown, not zero.";
    return;
  }
  const document = root.ownerDocument;
  const label = document.createElement("label");
  label.append("GPU observation ");
  const select = document.createElement("select");
  select.className = "jl-select";
  select.dataset.viewerGpuObservation = "";
  samples.forEach((sample, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${index + 1} / ${samples.length} · ${sample.measurement}`;
    select.append(option);
  });
  select.value = String(selected);
  label.append(select);
  root.append(label);
  const note = document.createElement("p");
  if (sample.measurement === "intervals") {
    note.textContent = `${sample.completeness}. GPU busy ${milliseconds(sample.metrics?.busyMs)}, pass sum ${milliseconds(sample.metrics?.combinedSumMs)}, elapsed span ${milliseconds(sample.metrics?.elapsedSpanMs)}. ${sample.omittedPasses} omitted passes. ${sample.issues.join(", ")}. GPU clock ${sample.clock.id}; offsets are relative to GPU origin ${sample.clock.originNs} ns, not CPU frame time.`;
  } else {
    note.textContent = `${sample.measurement}: ${milliseconds(sample.durationMs)}. ${sample.omittedPasses} omitted passes. Duration measurements do not establish interval coverage.`;
  }
  root.append(note);
  const table = tableContainer(root, "GPU pass evidence");
  renderTable(
    table,
    "GPU pass evidence",
    ["Pass / ID", "Kind", "Start / end", "Duration / diagnostic"],
    gpuRows(sample),
  );
  root.append(table);
}
function gpuRows(sample: GpuSample): string[][] {
  if (sample.measurement !== "intervals") {
    return sample.passes.map((pass) => [
      pass.label,
      sample.measurement,
      "Unknown",
      milliseconds(pass.durationMs),
    ]);
  }
  const rows = sample.passes.map((pass) => [
    `${pass.label} / ${pass.id} #${pass.invocation}`,
    pass.type,
    `${milliseconds(pass.startNs / 1e6)} / ${milliseconds(pass.endNs / 1e6)}`,
    milliseconds((pass.endNs - pass.startNs) / 1e6),
  ]);
  for (const pass of sample.rejectedPasses) {
    rows.push([
      `${pass.label} / ${pass.id} #${pass.invocation}`,
      pass.type,
      `Raw ns: ${pass.startNs ?? "missing"} / ${pass.endNs ?? "missing"}`,
      `Rejected: ${pass.reason}. Duration unknown.`,
    ]);
  }
  return rows;
}

export function renderRecordingEvidence(
  root: HTMLElement,
  recording: Recording,
  trial?: ComparisonTrial,
): void {
  const duration = recording.frames.reduce(
    (sum, frame) => sum + frame.endedAtMs - frame.startedAtMs,
    0,
  );
  const metrics = trial ?? summarizeComparisonTrial(recording, duration || 1);
  const coverage = summarizeGpuCoverage(recording);
  write(
    root,
    "evidence",
    `${recording.frames.length} frames · ${milliseconds(duration)} sealed duration · CPU samples ${percent(metrics.cpuCoverage)} · GPU samples ${percent(metrics.gpuCoverage)} (${metrics.gpuMeasurement ?? "unknown measurement"}) · GPU interval coverage ${coverage.coveragePercent === null ? "Unknown" : `${coverage.coveragePercent.toFixed(1)}%`} · ${coverage.missingFrames} missing, ${coverage.incompleteFrames} incomplete, ${coverage.sampledFrames} sampled out. ${coverage.reasons.map((item) => `${item.reason}: ${item.frames}`).join("; ")} Truncated: ${recording.truncated ? "yes" : "no"}. ${trial?.finalization ?? ""}`,
  );
  const metadata = recording.metadata;
  write(
    root,
    "environment",
    `${metadata.application?.name ?? "Unnamed application"} · ${metadata.createdAt} · ${metadata.environment.userAgent ?? "Browser not recorded"} · ${recording.targetFps} FPS budget. ${recording.gpu.filter((sample) => sample.frameId === null).length} unlinked GPU samples. Duration coverage and interval coverage are distinct.`,
  );
}
