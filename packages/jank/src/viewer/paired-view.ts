import {
  type ComparedWork,
  compareFrameWork,
  frameAtElapsed,
  type WorkIdentity,
  type WorkMeasurement,
} from "../analysis/frame-comparison.ts";
import { fitTimelineWindow } from "../analysis/timeline.ts";
import { drawRecordingChart } from "../charts/recording-chart.ts";
import { renderCompactWork } from "./compact-inspector.ts";
import { element, milliseconds, renderTable } from "./dom.ts";
import type { ViewerState } from "./viewer.ts";

type LoadedState = Extract<ViewerState, { status: "loaded" }>;
export function selectedPair(state: LoadedState) {
  const selected = state.comparison?.trials[state.selectedTrialIndex ?? 0];
  return {
    a:
      state.comparison?.trials.find(
        (trial) => trial.pair === selected?.pair && trial.variant === "A",
      ) ?? null,
    b:
      state.comparison?.trials.find(
        (trial) => trial.pair === selected?.pair && trial.variant === "B",
      ) ?? null,
  };
}
export function pairedWindow(state: LoadedState) {
  return fitTimelineWindow(
    state.comparisonWindowStartMs,
    state.comparisonWindowMs,
    state.comparison?.options.measureMs ?? 1000,
  );
}
export function drawPairedCharts(root: HTMLElement, state: LoadedState): void {
  const pair = selectedPair(state);
  const window = pairedWindow(state);
  const sides = (["a", "b"] as const).map((side) => {
    const recording = pair[side]?.recording ?? null;
    const originMs = recording?.frames[0]?.startedAtMs ?? 0;
    const frames =
      recording?.frames.filter(
        (frame) =>
          frame.endedAtMs - originMs > window.fromMs && frame.startedAtMs - originMs < window.toMs,
      ) ?? [];
    return { side, recording, originMs, frames };
  });
  const a = sides[0];
  const b = sides[1];
  if (!a || !b) {
    return;
  }
  const canvas = element<HTMLCanvasElement>(root, '[data-paired-chart="overlay"]');
  drawRecordingChart(canvas, {
    frames: a.frames,
    budgetMs: 1000 / (state.comparison?.targetFps ?? 60),
    selectedFrameId: frameAtElapsed(a.recording, state.comparisonElapsedMs)?.id ?? null,
    timeline: { ...window, originMs: a.originMs, selectedMs: state.comparisonElapsedMs },
    visible: element<HTMLInputElement>(root, '[data-series-visibility="a"]').checked,
    overlay: {
      frames: b.frames,
      originMs: b.originMs,
      visible: element<HTMLInputElement>(root, '[data-series-visibility="b"]').checked,
    },
  });
  canvas.setAttribute(
    "aria-label",
    `A/B elapsed timeline, ${window.fromMs} to ${window.toMs} milliseconds, cursor ${state.comparisonElapsedMs} milliseconds. A cyan solid; B violet dashed. Shared time and height scales.`,
  );
}

function measurementText(value: WorkMeasurement): string {
  return `${milliseconds(value.durationMs)} · ${value.note}`;
}
function differenceText(value: number | null): string {
  if (value === null) {
    return "Unknown";
  }
  if (value === 0) {
    return "0.00 ms · unchanged";
  }
  return `${value > 0 ? "+" : "−"}${milliseconds(Math.abs(value))} · ${value > 0 ? "longer" : "shorter"}`;
}
export function renderPaired(
  root: HTMLElement,
  state: LoadedState,
  catalog: readonly WorkIdentity[],
): void {
  const pair = selectedPair(state);
  const elapsedMs = state.comparisonElapsedMs;
  const window = pairedWindow(state);
  const input = element<HTMLInputElement>(root, "[data-paired-time]");
  input.value = String(elapsedMs);
  input.max = String(state.comparison?.options.measureMs ?? 0);
  input.disabled = !pair.a && !pair.b;
  const zoom = element<HTMLSelectElement>(root, "[data-paired-window]");
  const duration = String(state.comparisonWindowMs);
  zoom.querySelector("[data-custom-window]")?.remove();
  if (![...zoom.options].some((option) => option.value === duration)) {
    const option = root.ownerDocument.createElement("option");
    option.value = duration;
    option.textContent = duration;
    option.dataset.customWindow = "";
    zoom.append(option);
  }
  zoom.value = duration;
  const scroll = element<HTMLInputElement>(root, "[data-paired-scroll]");
  scroll.max = String(
    Math.max(0, (state.comparison?.options.measureMs ?? 0) - (window.toMs - window.fromMs)),
  );
  scroll.value = String(window.fromMs);
  scroll.disabled = Number(scroll.max) === 0;
  element<HTMLElement>(root, "[data-paired-range]").textContent =
    `Elapsed window ${window.fromMs.toFixed(2)}–${window.toMs.toFixed(2)} ms · cursor ${milliseconds(elapsedMs)} · shared horizontal and vertical scales.`;
  for (const side of ["a", "b"] as const) {
    const trial = pair[side];
    const frame = frameAtElapsed(trial?.recording ?? null, elapsedMs);
    element<HTMLElement>(root, `[data-paired-title="${side}"]`).textContent = trial
      ? `${side.toUpperCase()} · pair ${trial.pair} · ${trial.context.label}`
      : `${side.toUpperCase()} · trial unavailable`;
    const originMs = trial?.recording.frames[0]?.startedAtMs ?? 0;
    element<HTMLElement>(root, `[data-paired-frame="${side}"]`).textContent = frame
      ? `Frame #${frame.id} · ${(frame.startedAtMs - originMs).toFixed(2)}–${(frame.endedAtMs - originMs).toFixed(2)} ms elapsed · frame ${milliseconds(frame.endedAtMs - frame.startedAtMs)} · CPU update ${milliseconds(frame.cpu.updateMs)}, render ${milliseconds(frame.cpu.renderMs)} · scopes ${frame.coverage.status}.`
      : "No frame at this elapsed time. Timing is unknown.";
  }
  const rows = compareFrameWork(
    catalog,
    {
      recording: pair.a?.recording ?? null,
      frame: frameAtElapsed(pair.a?.recording ?? null, elapsedMs),
    },
    {
      recording: pair.b?.recording ?? null,
      frame: frameAtElapsed(pair.b?.recording ?? null, elapsedMs),
    },
  );
  renderCompactWork(root, rows, true);
  renderWorkTable(root, rows, "cpu");
  renderWorkTable(root, rows, "gpu");
  drawPairedCharts(root, state);
}

function renderWorkTable(
  root: HTMLElement,
  rows: readonly ComparedWork[],
  kind: "cpu" | "gpu",
): void {
  const container = element<HTMLElement>(root, `[data-paired-${kind}]`);
  const selected = rows.filter((row) => row.kind === kind);
  renderTable(
    container,
    kind === "cpu" ? "CPU scope comparison" : "GPU pass comparison",
    ["Work / identity", "A", "B", "B − A"],
    selected.map((row) => [
      row.label,
      measurementText(row.a),
      measurementText(row.b),
      differenceText(row.differenceMs),
    ]),
  );
  if (selected.length === 0) {
    const note = root.ownerDocument.createElement("p");
    note.className = "jank-viewer-note";
    note.textContent =
      kind === "gpu"
        ? "No GPU pass identities were recorded. Timing is unknown."
        : "No CPU scope identities were recorded. Scope timing is unknown.";
    container.append(note);
  }
  for (const [index, row] of selected.entries()) {
    const cells = container.querySelectorAll("tbody tr")[index]?.querySelectorAll("td");
    cells?.[1]?.classList.toggle("jank-viewer-unknown", row.a.durationMs === null);
    cells?.[2]?.classList.toggle("jank-viewer-unknown", row.b.durationMs === null);
    cells?.[3]?.classList.toggle(
      "jank-viewer-difference",
      row.differenceMs !== null && row.differenceMs !== 0,
    );
  }
}
