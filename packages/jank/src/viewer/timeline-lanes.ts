import type { LaneSample, TimelineModel, TimelineWindow } from "../analysis/timeline.ts";
import { milliseconds } from "./dom.ts";

const svgNamespace = "http://www.w3.org/2000/svg";
export function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}
export function percent(atMs: number, window: TimelineWindow): string {
  return `${(100 * (atMs - window.fromMs)) / (window.toMs - window.fromMs)}%`;
}
export function surface(container: HTMLElement, label: string): SVGSVGElement {
  const svg = svgElement(container.ownerDocument, "svg", {
    width: "100%",
    height: 26,
    role: "img",
    "aria-label": label,
    tabindex: 0,
    "data-lane-surface": "",
  });
  for (const cursor of ["selected", "hover"]) {
    svg.append(
      svgElement(container.ownerDocument, "line", {
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 26,
        "data-lane-cursor": cursor,
        visibility: "hidden",
      }),
    );
  }
  return svg;
}
function renderEvents(container: HTMLElement, model: TimelineModel, name: string): void {
  const document = container.ownerDocument;
  const label = document.createElement("label");

  const select = document.createElement("select");
  select.className = "jl-select";
  select.dataset.timelineEvent = "";
  select.dataset.eventSeries = name;
  select.setAttribute("aria-label", `${name} timeline event`);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = `${name === "Recording" ? "Events" : name} · ${model.events.length}`;
  select.append(placeholder);
  select.disabled = model.events.length === 0;
  const svg = surface(container, `${name} event markers`);
  let lastLabelEnd = -Infinity;
  for (const event of model.events) {
    const option = document.createElement("option");
    option.value = String(event.elapsedMs);
    option.textContent = `${milliseconds(event.elapsedMs)} · ${event.label}`;
    select.append(option);
    const marker = svgElement(document, "line", {
      x1: percent(event.elapsedMs, model.window),
      x2: percent(event.elapsedMs, model.window),
      y1: 5,
      y2: 24,
      "data-event-marker": "",
    });
    const title = svgElement(document, "title", {});
    title.textContent = `${option.textContent}${event.detail === null ? "" : ` · ${event.detail}`}`;
    marker.append(title);
    svg.append(marker);
    const x =
      ((event.elapsedMs - model.window.fromMs) / (model.window.toMs - model.window.fromMs)) *
      container.clientWidth;
    if (x > lastLabelEnd) {
      const text = svgElement(document, "text", {
        x: percent(event.elapsedMs, model.window),
        y: 14,
        dx: 4,
      });
      text.textContent = event.label.slice(0, 18);
      svg.append(text);
      lastLabelEnd = x + text.textContent.length * 7 + 12;
    }
  }
  label.append(select);
  const row = document.createElement("div");
  row.className = "jank-viewer-events-row";
  const pickers = document.createElement("div");
  pickers.className = "jank-viewer-event-pickers";
  pickers.append(label);
  row.append(pickers, svg);
  container.append(row);
}
function renderSample(
  svg: SVGElement,
  sample: LaneSample,
  model: TimelineModel,
  maximumMs: number,
): void {
  if (sample.durationMs === null) {
    return;
  }
  const from = Math.max(model.window.fromMs, sample.fromMs);
  const to = Math.min(model.window.toMs, sample.toMs);
  const height = Math.max(1, (sample.durationMs / maximumMs) * 23);
  const bar = svgElement(svg.ownerDocument, "rect", {
    x: percent(from, model.window),
    y: 25 - height,
    width: `${(100 * (to - from)) / (model.window.toMs - model.window.fromMs)}%`,
    height,
    "data-partial": String(!sample.comparable),
    "data-frame-id": sample.frameId,
  });
  const title = svgElement(svg.ownerDocument, "title", {});
  title.textContent = `Frame #${sample.frameId} · ${milliseconds(sample.durationMs)} · ${sample.note}`;
  bar.append(title);
  svg.prepend(bar);
}

interface LaneOptions {
  name: string;
  maximumMs: number;
  overlay?: TimelineModel | undefined;
}
export function renderTimelineLanes(
  container: HTMLElement,
  model: TimelineModel,
  options: LaneOptions,
): void {
  container.replaceChildren();
  renderEvents(container, model, options.overlay ? "A" : options.name);
  if (options.overlay) {
    renderEvents(container, options.overlay, "B");
  }
  let previousKind = "";
  for (const [index, lane] of model.lanes.entries()) {
    if (previousKind !== lane.identity.kind) {
      renderLaneHeading(container, lane.identity.kind, options.maximumMs);
      previousKind = lane.identity.kind;
    }
    renderLane(container, model, index, options);
  }
  renderEmptyLanes(container, model);
}

export function updateLaneCursor(
  container: HTMLElement,
  model: TimelineModel,
  cursor: { selectedMs: number; hoverMs: number | null; overlay?: TimelineModel | undefined },
): void {
  for (const line of container.querySelectorAll("[data-lane-cursor]")) {
    const time =
      line.getAttribute("data-lane-cursor") === "selected" ? cursor.selectedMs : cursor.hoverMs;
    const visible = time !== null && time >= model.window.fromMs && time <= model.window.toMs;
    line.setAttribute("visibility", visible ? "visible" : "hidden");
    if (time !== null) {
      line.setAttribute("x1", percent(time, model.window));
      line.setAttribute("x2", percent(time, model.window));
    }
  }
  const time = cursor.hoverMs ?? cursor.selectedMs;
  const values = container.querySelectorAll<HTMLElement>("[data-lane-readout]");
  model.lanes.forEach((lane, index) => {
    const sample = lane.samples.find((sample) => sample.fromMs <= time && time < sample.toMs);
    const value = values[index];
    if (!value) {
      return;
    }
    const b = cursor.overlay?.lanes[index]?.samples.find(
      (sample) => sample.fromMs <= time && time < sample.toMs,
    );
    const format = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(1));
    value.textContent =
      format(sample?.durationMs) + (cursor.overlay ? ` / ${format(b?.durationMs)}` : "");
    value.title = `${cursor.hoverMs === null ? "Selected" : "Hover"} ${milliseconds(time)} · ${milliseconds(sample?.durationMs)} · ${sample?.note ?? "No frame in this window"}${cursor.overlay ? ` · B ${milliseconds(b?.durationMs)} · ${b?.note ?? "No frame in this window"}` : ""}`;
    value.setAttribute("aria-label", value.title);
    value.parentElement?.setAttribute("title", value.title);
    value.parentElement?.classList.toggle("jank-viewer-unknown", sample?.durationMs == null);
  });
}

function renderEmptyLanes(container: HTMLElement, model: TimelineModel): void {
  if (model.lanes.length) {
    return;
  }
  const empty = container.ownerDocument.createElement("p");
  empty.textContent = "No CPU scopes or GPU pass identities recorded. Timing is unknown.";
  container.append(empty);
}

function renderLaneHeading(container: HTMLElement, kind: string, maximumMs: number): void {
  const heading = container.ownerDocument.createElement("div");
  heading.className = "jank-viewer-lane-group";
  const title = container.ownerDocument.createElement("b");
  title.textContent = kind === "frame" ? "FRAME CONTEXT" : kind.toUpperCase();
  const scale = container.ownerDocument.createElement("span");
  scale.textContent = `0–${maximumMs.toFixed(1)} ms`;
  heading.append(title, scale);
  container.append(heading);
}
function renderLane(
  container: HTMLElement,
  model: TimelineModel,
  index: number,
  options: LaneOptions,
): void {
  const lane = model.lanes[index];
  if (!lane) {
    return;
  }
  const row = container.ownerDocument.createElement("div");
  row.className = "jank-viewer-lane";
  row.dataset.laneKind = lane.identity.kind;
  const heading = container.ownerDocument.createElement("div");
  heading.className = "jank-viewer-lane-heading";
  const name = container.ownerDocument.createElement("span");
  name.dataset.laneName = "";
  const overhead = lane.identity.kind === "frame" && lane.identity.key === "overhead";
  const laneMaximumMs = overhead ? options.maximumMs / 20 : options.maximumMs;
  name.textContent = lane.identity.displayLabel + (overhead ? " ×20" : "");
  name.title = lane.identity.label;
  const value = container.ownerDocument.createElement("span");
  value.dataset.laneReadout = "";
  heading.append(name, value);
  const svg = surface(
    container,
    `${options.name} ${lane.identity.label} duration lane; arrow keys select frames`,
  );
  const a = svgElement(container.ownerDocument, "g", options.overlay ? { "data-series": "a" } : {});
  for (const sample of lane.samples) {
    renderSample(a, sample, model, laneMaximumMs);
  }
  svg.prepend(a);
  if (options.overlay) {
    const b = svgElement(container.ownerDocument, "g", { "data-series": "b" });
    for (const sample of options.overlay.lanes[index]?.samples ?? []) {
      renderSample(b, sample, options.overlay, laneMaximumMs);
    }
    a.after(b);
  }
  row.append(heading, svg);
  container.append(row);
}
