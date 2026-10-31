import {
  buildCounterTimeline,
  type CounterTimeline,
  counterCatalog,
} from "../analysis/counter-timeline.ts";
import type { WorkIdentity } from "../analysis/frame-comparison.ts";
import {
  buildTimeline,
  fitTimelineWindow,
  type TimelineModel,
  type TimelineWindow,
  zoomTimelineWindow,
} from "../analysis/timeline.ts";
import type { FrameSample } from "../core/frames.ts";
import { renderCounterLanes, updateCounterReadout } from "./counter-view.ts";
import { element } from "./dom.ts";
import { pairedWindow, selectedPair } from "./paired-view.ts";
import { renderTimelineLanes, updateLaneCursor } from "./timeline-lanes.ts";
import type { ViewerState } from "./viewer.ts";

interface TimelineHost {
  state(): ViewerState;
  select(elapsedMs: number): void;
  range(firstIndex: number, count: number): void;
  window(fromMs: number, durationMs: number): void;
}

export function recordingWindow(state: ViewerState): TimelineWindow {
  if (state.status !== "loaded" || !state.recording) {
    return { fromMs: 0, toMs: 1 };
  }
  const frames = state.recording.frames;
  const origin = frames[0]?.startedAtMs ?? 0;
  const first = frames[state.firstVisibleIndex];
  const last =
    frames[Math.min(frames.length - 1, state.firstVisibleIndex + state.visibleFrameCount - 1)];
  return {
    fromMs: (first?.startedAtMs ?? origin) - origin,
    toMs: (last?.endedAtMs ?? origin + 1) - origin,
  };
}

/** Owns derived lane models and transient hover; the viewer remains the owner of selection and ranges. */
export function createTimelineNavigation(root: HTMLElement, host: TimelineHost) {
  const timelines = new Map<string, TimelineModel>();
  const counters = new Map<string, CounterTimeline>();
  let hoverMs: number | null = null;
  let hoverSide = "single";
  function renderLanes(
    catalog: readonly WorkIdentity[],
    recordingCatalog: readonly WorkIdentity[],
  ): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    hoverMs = null;
    timelines.clear();
    counters.clear();
    const single = buildTimeline(state.recording, recordingCatalog, recordingWindow(state));
    timelines.set("single", single);
    if (state.comparison) {
      const pair = selectedPair(state);
      const identities = counterCatalog(pair.a?.recording ?? null, pair.b?.recording ?? null);
      for (const side of ["a", "b"] as const) {
        counters.set(
          side,
          buildCounterTimeline(pair[side]?.recording ?? null, identities, pairedWindow(state)),
        );
        timelines.set(
          side,
          buildTimeline(pair[side]?.recording ?? null, catalog, pairedWindow(state)),
        );
      }
    }
    if (!state.comparison) {
      counters.set(
        "single",
        buildCounterTimeline(
          state.recording,
          counterCatalog(state.recording, null),
          recordingWindow(state),
        ),
      );
    }
    renderModels(root, timelines, 1000 / (state.recording?.targetFps ?? 60), counters);
    const scroll = element<HTMLInputElement>(root, "[data-recording-scroll]");
    scroll.max = String(Math.max(0, (state.recording?.frames.length ?? 0) - 1));
    scroll.value = String(state.firstVisibleIndex);
    scroll.disabled = Number(scroll.max) === 0;
    updateLaneCursors();
  }
  function updateLaneCursors(): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    const activeSide = state.comparison ? "a" : "single";
    const model = timelines.get(activeSide);
    if (model) {
      updateLaneCursor(
        element<HTMLElement>(
          root,
          `[data-timeline-lanes="${state.comparison ? "overlay" : "single"}"]`,
        ),
        model,
        {
          selectedMs: state.comparisonElapsedMs,
          hoverMs: (state.comparison === null) === (hoverSide === "single") ? hoverMs : null,
          overlay: timelines.get("b"),
        },
      );
    }
    const counterModel = counters.get(activeSide);
    if (counterModel) {
      updateCounterReadout(root, counterModel, {
        selectedMs: state.comparisonElapsedMs,
        hoverMs,
        overlay: counters.get("b"),
      });
    }
  }

  function changeTimelineControl(target: Element): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-paired-scroll]")) {
      host.window(target.valueAsNumber, state.comparisonWindowMs);
    } else if (target instanceof HTMLInputElement && target.matches("[data-recording-scroll]")) {
      host.range(target.valueAsNumber, state.visibleFrameCount);
    } else if (target instanceof HTMLSelectElement && target.value !== "") {
      selectEvent(target);
    }
  }
  function selectEvent(target: HTMLSelectElement): void {
    const container = target.closest<HTMLElement>("[data-timeline-lanes]");
    const value = target.value;
    host.select(Number(value));
    const next = [
      ...(container?.querySelectorAll<HTMLSelectElement>("[data-timeline-event]") ?? []),
    ].find((select) => select.dataset.eventSeries === target.dataset.eventSeries);
    if (next) {
      next.value = value;
      next.focus({ preventScroll: true });
    }
  }
  function timelineHit(
    event: MouseEvent,
  ): { side: string; elapsedMs: number; surface: Element } | null {
    if (!(event.target instanceof Element)) {
      return null;
    }
    const surface = event.target.closest("[data-lane-surface], [data-paired-chart]");
    if (!surface) {
      return null;
    }
    const side =
      surface.closest<HTMLElement>("[data-timeline-lanes]")?.dataset.timelineLanes ??
      surface.getAttribute("data-paired-chart") ??
      "single";
    const model = timelines.get(side === "overlay" ? "a" : side);
    if (!model) {
      return null;
    }
    const bounds = surface.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    return {
      side,
      elapsedMs: model.window.fromMs + fraction * (model.window.toMs - model.window.fromMs),
      surface,
    };
  }
  function zoomTimeline(side: string, factor: number, anchorMs?: number): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    if (side === "single") {
      const counts = [50, 100, 200];
      const index = counts.indexOf(state.visibleFrameCount);
      const count = counts[Math.max(0, Math.min(2, index + (factor < 1 ? -1 : 1)))];
      if (count && state.recording?.frames.length) {
        host.range(state.firstVisibleIndex, count);
      }
      return;
    }
    const next = zoomTimelineWindow(pairedWindow(state), {
      anchorMs: anchorMs ?? state.comparisonElapsedMs,
      factor,
      totalMs: state.comparison?.options.measureMs ?? 1000,
    });
    host.window(next.fromMs, next.toMs - next.fromMs);
  }
  function timelinePointer(event: Event): void {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.type === "pointerout") {
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest("[data-lane-surface], [data-paired-chart]")
      ) {
        return;
      }
      hoverMs = null;
      updateLaneCursors();
      return;
    }
    const hit = timelineHit(event);
    if (!hit) {
      return;
    }
    if (event instanceof WheelEvent) {
      wheelTimeline(event, hit);
      return;
    }
    hoverMs = hit.elapsedMs;
    hoverSide = hit.side;
    updateLaneCursors();
  }
  function wheelTimeline(
    event: WheelEvent,
    hit: { side: string; elapsedMs: number; surface: Element },
  ): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomTimeline(hit.side, event.deltaY < 0 ? 0.5 : 2, hit.elapsedMs);
      return;
    }
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta) {
      return;
    }
    event.preventDefault();
    const pixels = delta * (event.deltaMode === 1 ? 16 : 1);
    panTimeline(hit.side, pixels, hit.surface.getBoundingClientRect().width);
  }
  function panTimeline(side: string, pixels: number, width: number): void {
    const state = host.state();
    if (state.status !== "loaded") {
      return;
    }
    if (side === "single") {
      const index = Math.max(
        0,
        Math.min(
          (state.recording?.frames.length ?? 1) - 1,
          state.firstVisibleIndex +
            Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / 10)),
        ),
      );
      if (state.recording?.frames.length) {
        host.range(index, state.visibleFrameCount);
      }
      return;
    }
    const window = pairedWindow(state);
    const next = fitTimelineWindow(
      window.fromMs + (pixels / width) * (window.toMs - window.fromMs),
      window.toMs - window.fromMs,
      state.comparison?.options.measureMs ?? 1000,
    );
    host.window(next.fromMs, state.comparisonWindowMs);
  }
  function navigateLaneKey(event: KeyboardEvent): void {
    const state = host.state();
    if (!(event.target instanceof Element) || state.status !== "loaded") {
      return;
    }
    const side =
      event.target.closest<HTMLElement>("[data-timeline-lanes]")?.dataset.timelineLanes ?? "single";
    const pair = selectedPair(state);
    const recording =
      side === "single" || side === "overlay"
        ? state.recording
        : pair[side === "a" ? "a" : "b"]?.recording;
    const origin = recording?.frames[0]?.startedAtMs ?? 0;
    const elapsed = state.comparisonElapsedMs;
    const frames = recording?.frames ?? [];
    const next = frameTimeFromKey(frames, event.key, origin + elapsed);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    const key = event.target.getAttribute("aria-label");
    host.select(next - origin);
    focusLane(root, key);
  }

  function handle(event: Event): boolean {
    if (!(event.target instanceof Element)) {
      return false;
    }
    const target = event.target;
    if (
      (event.type === "change" || event.type === "input") &&
      target.matches("[data-paired-scroll], [data-recording-scroll], [data-timeline-event]")
    ) {
      changeTimelineControl(target);
      return true;
    }
    if (event instanceof KeyboardEvent && target.matches("[data-lane-surface]")) {
      navigateLaneKey(event);
      return true;
    }
    if (event.type === "click" && event instanceof MouseEvent) {
      return clickTimeline(event);
    }
    if (["pointermove", "pointerout", "wheel"].includes(event.type)) {
      timelinePointer(event);
      return true;
    }
    return false;
  }
  function clickTimeline(event: MouseEvent): boolean {
    if (!(event.target instanceof Element)) {
      return false;
    }
    const zoom = event.target.closest<HTMLElement>("[data-timeline-zoom]");
    if (zoom) {
      zoomTimeline(zoom.dataset.timelineSide ?? "a", zoom.dataset.timelineZoom === "in" ? 0.5 : 2);
      return true;
    }
    const hit = timelineHit(event);
    if (!hit) {
      return false;
    }
    host.select(hit.elapsedMs);
    return true;
  }
  return {
    render: renderLanes,
    handle,
    clear: () => {
      timelines.clear();
      counters.clear();
      hoverMs = null;
    },
  };
}

function timelinePeak(model: TimelineModel, budgetMs: number): number {
  let peak = budgetMs;
  for (const lane of model.lanes) {
    for (const sample of lane.samples) {
      peak = Math.max(peak, sample.durationMs ?? 0);
    }
  }
  return peak;
}
function renderModels(
  root: HTMLElement,
  timelines: ReadonlyMap<string, TimelineModel>,
  budgetMs: number,
  counters: ReadonlyMap<string, CounterTimeline>,
): void {
  const a = timelines.get("a");
  const b = timelines.get("b");
  const single = timelines.get("single");
  if (a && b) {
    renderTimelineLanes(element<HTMLElement>(root, '[data-timeline-lanes="overlay"]'), a, {
      name: "A/B",
      maximumMs: Math.max(timelinePeak(a, budgetMs), timelinePeak(b, budgetMs)),
      overlay: b,
    });
    const counterModel = counters.get("a");
    if (counterModel) {
      renderCounterLanes(
        element<HTMLElement>(root, '[data-timeline-lanes="overlay"]'),
        counterModel,
        counters.get("b"),
      );
    }
  } else if (single) {
    renderTimelineLanes(element<HTMLElement>(root, '[data-timeline-lanes="single"]'), single, {
      name: "Recording",
      maximumMs: timelinePeak(single, budgetMs),
    });
    const counterModel = counters.get("single");
    if (counterModel) {
      renderCounterLanes(
        element<HTMLElement>(root, '[data-timeline-lanes="single"]'),
        counterModel,
      );
    }
  }
}

function frameTimeFromKey(
  frames: readonly FrameSample[],
  key: string,
  atMs: number,
): number | undefined {
  switch (key) {
    case "ArrowRight":
      return frames.find((frame) => frame.startedAtMs > atMs)?.startedAtMs;
    case "ArrowLeft":
      return frames.findLast((frame) => frame.startedAtMs < atMs)?.startedAtMs;
    case "Home":
      return frames[0]?.startedAtMs;
    case "End":
      return frames.at(-1)?.startedAtMs;
    default:
      return undefined;
  }
}

/** Selection redraws evidence; restore keyboard focus to the same stable lane. */
function focusLane(root: HTMLElement, label: string | null): void {
  for (const surface of root.querySelectorAll<SVGSVGElement>("[data-lane-surface]")) {
    if (surface.getAttribute("aria-label") === label) {
      surface.focus({ preventScroll: true });
    }
  }
}
