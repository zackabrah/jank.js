import { frameEvidence, nearbyEvents } from "../analysis/frame-evidence.ts";
import { element, write } from "./dom.ts";
import type { ViewerState } from "./viewer.ts";

export function renderInspectorActions(root: HTMLElement, state: ViewerState): void {
  element<HTMLElement>(root, "[data-copy-fallback]").hidden = true;
  element<HTMLElement>(root, "[data-frame-report]").textContent = "";
  const recording = state.status === "loaded" ? state.recording : null;
  element<HTMLButtonElement>(root, "[data-copy-frame]").disabled =
    !recording || state.status !== "loaded" || state.selectedFrameId === null;
  const container = element<HTMLElement>(root, "[data-nearby-events]");
  container.replaceChildren();
  if (!recording || state.status !== "loaded") {
    return;
  }
  const events = nearbyEvents(recording, state.comparisonElapsedMs);
  if (events.length === 0) {
    container.textContent = "No nearby events";
  }
  for (const event of events) {
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "jl-btn jank-viewer-nearby-event";
    button.dataset.nearbyEvent = String(event.index);
    button.textContent = `${event.offsetMs > 0 ? "+" : ""}${event.offsetMs.toFixed(2)} ms · ${event.label}`;
    button.title = event.detail ?? `Jump to ${event.elapsedMs.toFixed(2)} ms`;
    container.append(button);
  }
}

export async function copyFrameEvidence(
  root: HTMLElement,
  state: ViewerState,
  isCurrent: () => boolean,
): Promise<void> {
  if (state.status !== "loaded" || !state.recording) {
    return;
  }
  const evidence = frameEvidence(state.recording, state.selectedFrameId);
  if (!evidence) {
    return;
  }
  element<HTMLElement>(root, "[data-copy-fallback]").hidden = true;
  const trial = state.comparison?.trials[state.selectedTrialIndex ?? 0];
  const text = JSON.stringify(
    {
      ...evidence,
      trial: trial ? { pair: trial.pair, variant: trial.variant, context: trial.context } : null,
    },
    null,
    2,
  );
  try {
    const clipboard = root.ownerDocument.defaultView?.navigator.clipboard;
    if (!clipboard) {
      throw new Error("Clipboard unavailable");
    }
    await clipboard.writeText(text);
    if (isCurrent()) {
      write(root, "status", `Frame #${evidence.frame.id} copied as diagnostic JSON`);
    }
  } catch {
    if (!isCurrent()) {
      return;
    }
    element<HTMLElement>(root, "[data-copy-fallback]").hidden = false;
    const report = element<HTMLElement>(root, "[data-frame-report]");
    report.textContent = text;
    report.focus();
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(report);
    const selection = root.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    write(
      root,
      "status",
      `Clipboard unavailable. Frame #${evidence.frame.id} report selected for manual copy.`,
    );
  }
}
