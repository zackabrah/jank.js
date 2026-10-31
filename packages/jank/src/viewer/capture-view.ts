import type { CaptureMark } from "../analysis/capture-marks.ts";
import { captureContextFrames } from "../recordings/excerpt.ts";
import { element, renderTable } from "./dom.ts";
import { renderEpisode } from "./episode-view.ts";
import { sessionDuration } from "./session-view.ts";
import type { ViewerState } from "./viewer.ts";

type LoadedState = Extract<ViewerState, { status: "loaded" }>;

export function captureAtSelection(
  state: LoadedState,
  marks: readonly CaptureMark[],
): CaptureMark | null {
  const index =
    state.recording?.frames.findIndex((frame) => frame.id === state.selectedFrameId) ?? -1;
  if (index < 0) {
    return null;
  }
  let nearest: CaptureMark | null = null;
  for (const mark of marks) {
    const distance = Math.abs(mark.frameIndex - index);
    if (mark.source === "recorded") {
      return mark;
    }
    if (
      distance <= captureContextFrames &&
      (!nearest || distance < Math.abs(nearest.frameIndex - index))
    ) {
      nearest = mark;
    }
  }
  return nearest;
}
function captureButton(
  root: HTMLElement,
  mark: CaptureMark,
  action: "open" | "export",
  overview = false,
): HTMLButtonElement {
  const button = root.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "jl-btn";
  button.dataset.captureAction = action;
  button.dataset.captureFrame = String(mark.frameId);
  button.textContent = overview ? `#${mark.rank}` : action.toUpperCase();
  const verb = action === "open" ? "Open" : "Export";
  button.setAttribute("aria-label", `${overview ? "Overview" : verb} capture ${mark.rank}`);
  button.title = `Frame #${mark.frameId} · ${mark.durationMs.toFixed(2)} ms · ${mark.source}`;
  return button;
}
export function renderCaptures(
  root: HTMLElement,
  state: LoadedState,
  marks: readonly CaptureMark[],
): void {
  const recording = state.recording;
  renderTriggerContext(root, state, marks);
  renderEpisode(root, recording);
  const container = element<HTMLElement>(root, "[data-capture-list]");
  const rule = element<HTMLElement>(root, "[data-capture-rule]");
  const trial = state.comparison?.trials[state.selectedTrialIndex ?? 0];
  const source = recording?.capture;
  rule.textContent =
    source?.kind === "automatic"
      ? `Recorded automatic trigger · >${source.thresholdMs.toFixed(2)} ms${source.sustained ? ` budget for ${source.sustained.durationMs} ms continuously` : ""} · ${source.beforeFrames} before / ${source.afterFrames} after`
      : `Detected spikes · >${(2000 / (recording?.targetFps ?? 60)).toFixed(2)} ms · up to ${captureContextFrames} frames each side`;
  if (trial) {
    rule.append(` · trial ${trial.variant}, pair ${trial.pair}`);
  }
  renderTable(
    container,
    "Capture spikes",
    ["Rank", "Frame", "Duration", "Nearby events", "Actions"],
    marks.map((mark) => [
      `#${mark.rank}`,
      String(mark.frameId),
      `${mark.durationMs.toFixed(2)} ms`,
      mark.nearbyEvents || "—",
      "",
    ]),
  );
  for (const [index, mark] of marks.entries()) {
    const row = container.querySelectorAll("tbody tr")[index];
    if (!row) {
      continue;
    }
    row.setAttribute("data-capture-row", String(mark.frameId));
    row
      .querySelector("td:last-child")
      ?.append(captureButton(root, mark, "open"), captureButton(root, mark, "export"));
  }
  if (!marks.length) {
    container.textContent = "No capture spikes in this recording.";
  }
  renderCaptureMarkers(root, state, marks);
  updateCaptureSelection(root, state, marks);
}
function renderCaptureMarkers(
  root: HTMLElement,
  state: LoadedState,
  marks: readonly CaptureMark[],
): void {
  const container = element<HTMLElement>(root, "[data-session-markers]");
  container.replaceChildren();
  const variant = state.comparison?.trials[state.selectedTrialIndex ?? 0]?.variant;
  if (variant) {
    container.dataset.series = variant.toLowerCase();
  } else {
    delete container.dataset.series;
  }
  for (const mark of marks) {
    const button = captureButton(root, mark, "open", true);
    button.style.left = `clamp(10px, ${(100 * mark.elapsedMs) / sessionDuration(state)}%, calc(100% - 10px))`;
    container.append(button);
  }
}
export function updateCaptureSelection(
  root: HTMLElement,
  state: LoadedState,
  marks: readonly CaptureMark[],
): void {
  const mark = captureAtSelection(state, marks);
  const picker = element<HTMLSelectElement>(root, "[data-episode-trigger]");
  picker.value = String(state.selectedFrameId ?? "");
  for (const row of root.querySelectorAll<HTMLElement>("[data-capture-row]")) {
    row.setAttribute("aria-current", String(Number(row.dataset.captureRow) === mark?.frameId));
  }
  for (const button of root.querySelectorAll<HTMLElement>("[data-session-markers] button")) {
    button.setAttribute(
      "aria-current",
      String(Number(button.dataset.captureFrame) === mark?.frameId),
    );
  }
  element<HTMLButtonElement>(
    root,
    '[data-capture-action="export"]:not([data-capture-frame])',
  ).disabled = !mark;
  for (const action of ["previous", "next"]) {
    element<HTMLButtonElement>(root, `[data-capture-action="${action}"]`).disabled =
      marks.length === 0;
  }
  const clipped =
    mark?.source === "detected" &&
    (mark.frameIndex < captureContextFrames ||
      mark.frameIndex + captureContextFrames >= (state.recording?.frames.length ?? 0));
  element<HTMLElement>(root, "[data-capture-selection]").textContent = mark
    ? `Capture #${mark.rank} · ${mark.source}${clipped ? " · clipped context" : ""}${state.recording?.truncated ? " · source truncated" : ""}`
    : "No capture at this frame";
}

function renderTriggerContext(
  root: HTMLElement,
  state: LoadedState,
  marks: readonly CaptureMark[],
): void {
  const mark = marks.find((value) => value.source === "recorded");
  const summary = element<HTMLElement>(root, "[data-trigger-summary]");
  summary.hidden = !mark;
  const recording = state.recording;
  if (!mark || !recording) {
    return;
  }
  const trigger = recording.frames[mark.frameIndex];
  const first = recording.frames[0];
  const last = recording.frames.at(-1);
  if (!trigger || !first || !last) {
    return;
  }
  const before = ((trigger.startedAtMs - first.startedAtMs) / 1000).toFixed(2);
  const after = ((last.endedAtMs - trigger.endedAtMs) / 1000).toFixed(2);
  const samples = recording.gpu.filter((sample) => sample.frameId === trigger.id);
  const sampledOut =
    samples.length > 0 &&
    samples.every(
      (sample) => sample.measurement === "intervals" && sample.issues.includes("sampled-out"),
    );
  element<HTMLButtonElement>(summary, "[data-go-trigger]").dataset.captureFrame = String(
    trigger.id,
  );
  element<HTMLElement>(summary, "[data-trigger-context]").textContent =
    `Trigger #${trigger.id}${recording.capture.kind === "automatic" && recording.capture.sustained ? ` confirmed sustained slowdown · onset #${recording.capture.sustained.firstFrameId} at ${recording.capture.sustained.startedAtMs.toFixed(2)} ms (${recording.capture.sustained.frameCount} frames)` : ""} · ${before} s before · ${after} s after (retained context).${sampledOut ? " Trigger GPU not sampled; neighbouring samples cannot supply its timing." : ""}`;
}
