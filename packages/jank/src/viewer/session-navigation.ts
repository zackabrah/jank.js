import type { Recording } from "../recordings/recording.ts";
import { element } from "./dom.ts";
import { pairedWindow } from "./paired-view.ts";
import { sessionDuration } from "./session-view.ts";
import { recordingWindow } from "./timeline-navigation.ts";
import type { ViewerState } from "./viewer.ts";

/** Pointer capture keeps a session-range drag attached to this view; click still selects time. */
export function createSessionNavigation(
  root: HTMLElement,
  host: {
    state: () => ViewerState;
    pan: (fromMs: number) => void;
  },
) {
  const canvas = element<HTMLCanvasElement>(root, "[data-session-chart]");
  let drag: {
    pointerId: number;
    clientX: number;
    fromMs: number;
    durationMs: number;
    totalMs: number;
    recording: Recording;
    moved: boolean;
  } | null = null;
  let suppressClick = false;
  function clear(): void {
    const pointerId = drag?.pointerId;
    drag = null;
    canvas.style.removeProperty("cursor");
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }
  function handle(event: Event): boolean {
    if (event.type === "click" && event.target === canvas && suppressClick) {
      suppressClick = false;
      return true;
    }
    if (!(event instanceof PointerEvent)) {
      return false;
    }
    if (event.type === "pointerdown" && event.target === canvas && event.button === 0) {
      const state = host.state();
      if (state.status !== "loaded" || !state.recording) {
        return false;
      }
      const window = state.comparison ? pairedWindow(state) : recordingWindow(state);
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        fromMs: window.fromMs,
        durationMs: window.toMs - window.fromMs,
        totalMs: sessionDuration(state),
        recording: state.recording,
        moved: false,
      };
      suppressClick = false;
      canvas.setPointerCapture(event.pointerId);
      return true;
    }
    return update(event);
  }
  function update(event: PointerEvent): boolean {
    if (!drag || drag.pointerId !== event.pointerId) {
      return false;
    }
    const state = host.state();
    if (state.status !== "loaded" || state.recording !== drag.recording) {
      clear();
      return false;
    }
    if (event.type === "pointermove") {
      const delta = event.clientX - drag.clientX;
      drag.moved = drag.moved || Math.abs(delta) >= 3;
      if (drag.moved) {
        canvas.style.cursor = "grabbing";
        const width = canvas.getBoundingClientRect().width;
        host.pan(
          Math.max(
            0,
            Math.min(
              drag.totalMs - drag.durationMs,
              drag.fromMs + (delta / Math.max(1, width)) * drag.totalMs,
            ),
          ),
        );
      }
      return true;
    }
    if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type)) {
      suppressClick = drag.moved;
      clear();
      return true;
    }
    return false;
  }
  return { handle, clear };
}
