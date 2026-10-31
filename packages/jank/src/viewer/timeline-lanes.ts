import type { LaneSample, TimelineModel, TimelineWindow } from "../analysis/timeline.ts";
import { milliseconds } from "./dom.ts";

const svgNamespace = "http://www.w3.org/2000/svg";
function svgElement<K extends keyof SVGElementTagNameMap>(
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
function percent(atMs: number, window: TimelineWindow): string {
  return `${(100 * (atMs - window.fromMs)) / (window.toMs - window.fromMs)}%`;
}
function surface(container: HTMLElement, label: string): SVGSVGElement {
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
  label.append(`${name} timeline event `);
  const select = document.createElement("select");
  select.className = "jl-select";
  select.dataset.timelineEvent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = model.events.length ? "Choose event in window" : "No events in window";
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
  container.append(label, svg);
}
function renderSample(
  svg: SVGSVGElement,
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

export function renderTimelineLanes(
  container: HTMLElement,
  model: TimelineModel,
  options: { name: string; maximumMs: number },
): void {
  container.replaceChildren();
  const note = container.ownerDocument.createElement("p");
  note.className = "jank-viewer-note";
  note.textContent = `CPU / GPU durations · shared height scale 0–${milliseconds(options.maximumMs)}. Gaps are unknown; outlined bars are GPU or partial CPU samples. GPU timing is placed at its correlated frame, not on the CPU clock.`;
  container.append(note);
  renderEvents(container, model, options.name);
  for (const lane of model.lanes) {
    const row = container.ownerDocument.createElement("div");
    row.className = "jank-viewer-lane";
    row.dataset.laneKind = lane.identity.kind;
    const heading = container.ownerDocument.createElement("div");
    heading.className = "jank-viewer-lane-heading";
    const name = container.ownerDocument.createElement("span");
    name.dataset.laneName = "";
    name.textContent = `${lane.identity.kind.toUpperCase()} · ${lane.identity.label}`;
    name.title = name.textContent;
    const value = container.ownerDocument.createElement("span");
    value.dataset.laneReadout = "";
    heading.append(name, value);
    const svg = surface(
      container,
      `${options.name} ${lane.identity.label} duration lane; arrow keys select frames`,
    );
    for (const sample of lane.samples) {
      renderSample(svg, sample, model, options.maximumMs);
    }
    row.append(heading, svg);
    container.append(row);
  }
  if (model.lanes.length === 0) {
    const empty = container.ownerDocument.createElement("p");
    empty.textContent = "No CPU scopes or GPU pass identities recorded. Timing is unknown.";
    container.append(empty);
  }
}

export function updateLaneCursor(
  container: HTMLElement,
  model: TimelineModel,
  cursor: { selectedMs: number; hoverMs: number | null },
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
    value.textContent = `${cursor.hoverMs === null ? "Selected" : "Hover"} ${milliseconds(time)} · ${milliseconds(sample?.durationMs)} · ${sample?.note ?? "No frame in this window"}`;
    value.title = value.textContent;
    value.parentElement?.classList.toggle("jank-viewer-unknown", sample?.durationMs == null);
  });
}
