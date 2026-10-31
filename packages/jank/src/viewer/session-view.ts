import { drawRecordingChart } from "../charts/recording-chart.ts";
import { element } from "./dom.ts";
import { pairedWindow, selectedPair } from "./paired-view.ts";
import { recordingWindow } from "./timeline-navigation.ts";
import type { ViewerState } from "./viewer.ts";

type LoadedState = Extract<ViewerState, { status: "loaded" }>;
export function sessionDuration(state: LoadedState): number {
  const frames = state.recording?.frames;
  return (
    state.comparison?.options.measureMs ??
    Math.max(1, (frames?.at(-1)?.endedAtMs ?? 1) - (frames?.[0]?.startedAtMs ?? 0))
  );
}
function axis(root: HTMLElement, selector: string, from: number, to: number): void {
  const container = element<HTMLElement>(root, selector);
  container.replaceChildren();
  for (let tick = 0; tick <= 4; tick += 1) {
    const label = root.ownerDocument.createElement("span");
    label.textContent = `${((from + ((to - from) * tick) / 4) / 1000).toFixed(2)}s`;
    container.append(label);
  }
}
export function drawSession(root: HTMLElement, state: LoadedState): void {
  const pair = selectedPair(state);
  const a = state.comparison ? pair.a?.recording : state.recording;
  const b = pair.b?.recording;
  const duration = sessionDuration(state);
  const window = state.comparison ? pairedWindow(state) : recordingWindow(state);
  drawRecordingChart(element<HTMLCanvasElement>(root, "[data-session-chart]"), {
    frames: a?.frames ?? [],
    budgetMs: 1000 / (a?.targetFps ?? state.comparison?.targetFps ?? 60),
    selectedFrameId: state.selectedFrameId,
    timeline: {
      originMs: a?.frames[0]?.startedAtMs ?? 0,
      fromMs: 0,
      toMs: duration,
      selectedMs: state.comparisonElapsedMs,
    },
    visible:
      !state.comparison || element<HTMLInputElement>(root, '[data-series-visibility="a"]').checked,
    overlay: state.comparison
      ? {
          frames: b?.frames ?? [],
          originMs: b?.frames[0]?.startedAtMs ?? 0,
          visible: element<HTMLInputElement>(root, '[data-series-visibility="b"]').checked,
        }
      : undefined,
    overview: window,
  });
  element<HTMLElement>(root, "[data-session-info]").textContent =
    `${(duration / 1000).toFixed(2)}s · ${a?.frames.length ?? 0}${state.comparison ? ` / ${b?.frames.length ?? 0}` : ""} frames`;
  axis(root, "[data-session-axis]", 0, duration);
  axis(
    root,
    state.comparison ? "[data-paired-axis]" : "[data-recording-axis]",
    window.fromMs,
    window.toMs,
  );
}
