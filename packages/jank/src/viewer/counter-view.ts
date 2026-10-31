import {
  type CounterLane,
  type CounterTimeline,
  counterAtTime,
  counterScale,
} from "../analysis/counter-timeline.ts";
import type { TimelineWindow } from "../analysis/timeline.ts";
import { element, renderTable } from "./dom.ts";
import { percent, surface, svgElement } from "./timeline-lanes.ts";

export function renderCounterLanes(
  container: HTMLElement,
  model: CounterTimeline,
  overlay?: CounterTimeline,
): void {
  if (!model.lanes.length) {
    return;
  }
  const heading = container.ownerDocument.createElement("div");
  heading.className = "jank-viewer-lane-group";
  heading.textContent = "COUNTERS · raw values · sample points";
  container.append(heading);
  for (const [index, lane] of model.lanes.entries()) {
    const other = overlay?.lanes[index];
    const scale = counterScale(lane, other, model.window);
    const row = container.ownerDocument.createElement("div");
    row.className = "jank-viewer-lane";
    row.dataset.laneKind = "counter";
    const label = container.ownerDocument.createElement("div");
    label.className = "jank-viewer-lane-heading";
    const name = container.ownerDocument.createElement("span");
    name.dataset.counterName = "";
    name.textContent = counterLabel(lane, model);
    name.title = `${lane.identity.channelId} / ${lane.identity.name} · raw scale ${scale.minimum} to ${scale.maximum}`;
    label.append(name);
    const svg = surface(
      container,
      `${overlay ? "A/B" : "Recording"} ${lane.identity.channelId} / ${lane.identity.name} counter lane; arrow keys select frames`,
    );
    const a = svgElement(container.ownerDocument, "g", overlay ? { "data-series": "a" } : {});
    drawCounterPoints(a, lane, model.window, scale);
    svg.prepend(a);
    if (other) {
      const b = svgElement(container.ownerDocument, "g", { "data-series": "b" });
      drawCounterPoints(b, other, model.window, scale);
      a.after(b);
    }
    const range = svgElement(container.ownerDocument, "text", {
      x: "100%",
      y: 9,
      "text-anchor": "end",
      "data-counter-scale": "",
    });
    range.textContent = svg.querySelector("[data-counter-point]")
      ? `${scaleLabel(scale.minimum)}…${scaleLabel(scale.maximum)}`
      : "no samples";
    svg.append(range);
    row.append(label, svg);
    container.append(row);
  }
}
function drawCounterPoints(
  group: SVGElement,
  lane: CounterLane,
  window: TimelineWindow,
  scale: { minimum: number; maximum: number },
): void {
  // Normalize before subtraction so valid signed values near Number.MAX_VALUE cannot overflow the scale.
  const magnitude = Math.max(Math.abs(scale.minimum), Math.abs(scale.maximum));
  const minimum = scale.minimum / magnitude;
  const span = scale.maximum / magnitude - minimum;
  const y = (value: number) => 24 - (22 * (value / magnitude - minimum)) / span;
  for (const point of lane.points) {
    if (point.value === null || point.elapsedMs < window.fromMs || point.elapsedMs >= window.toMs) {
      continue;
    }
    const x = percent(point.elapsedMs, window);
    const mark = svgElement(group.ownerDocument, "g", {
      "data-counter-point": "",
      "data-counter-value": point.value,
      "data-elapsed-ms": point.elapsedMs,
    });
    const title = svgElement(group.ownerDocument, "title", {});
    title.textContent = `${lane.identity.label}: ${point.value} at ${point.elapsedMs.toFixed(2)} ms elapsed · observed sample`;
    mark.append(
      title,
      svgElement(group.ownerDocument, "line", { x1: x, x2: x, y1: y(0), y2: y(point.value) }),
      svgElement(group.ownerDocument, "circle", { cx: x, cy: y(point.value), r: 1.5 }),
    );
    group.append(mark);
  }
}
export function updateCounterReadout(
  root: HTMLElement,
  model: CounterTimeline,
  cursor: { selectedMs: number; hoverMs: number | null; overlay?: CounterTimeline | undefined },
): void {
  const time = cursor.hoverMs ?? cursor.selectedMs;
  const container = element<HTMLElement>(root, "[data-counter-inspector]");
  const caption = `${cursor.hoverMs === null ? "Selected" : "Hover"} counters at ${time.toFixed(2)} ms`;
  element<HTMLElement>(root, "[data-counter-time]").textContent =
    `${cursor.hoverMs === null ? "selected" : "hover"} ${time.toFixed(2)} ms`;
  if (!model.lanes.length) {
    container.textContent = "No numeric counters recorded.";
    return;
  }
  const observations = model.lanes.map((lane, index) => ({
    a: counterAtTime(lane, time),
    b: cursor.overlay?.lanes[index] ? counterAtTime(cursor.overlay.lanes[index], time) : null,
  }));
  renderTable(
    container,
    caption,
    cursor.overlay ? ["Counter", "A", "B"] : ["Counter", "Last observation"],
    model.lanes.map((lane, index) => {
      const sample = observations[index];
      const values = [lane.identity.name, counterText(sample?.a.value)];
      if (cursor.overlay) {
        values.push(counterText(sample?.b?.value));
      }
      return values;
    }),
  );
  const headers = container.querySelectorAll("th");
  if (cursor.overlay) {
    headers[1]?.classList.add("jank-series-a");
    headers[2]?.classList.add("jank-series-b");
  }
  const rows = container.querySelectorAll("tbody tr");
  const laneRows = root.querySelectorAll<HTMLElement>(
    `[data-timeline-lanes="${cursor.overlay ? "overlay" : "single"}"] [data-lane-kind="counter"]`,
  );
  observations.forEach((sample, index) => {
    const cells = rows[index]?.querySelectorAll("td");
    const identity = model.lanes[index]?.identity;
    if (cells?.[0] && identity) {
      cells[0].title = identity.label;
      const name = root.ownerDocument.createElement("span");
      name.textContent = identity.name;
      const provider = root.ownerDocument.createElement("small");
      provider.textContent = identity.channelId;
      cells[0].replaceChildren(name, provider);
    }
    const current = isCurrent(sample.a) || (sample.b !== null && isCurrent(sample.b));
    laneRows[index]?.classList.toggle("jank-viewer-unknown", !current);
    annotateObservation(cells?.[1], sample.a);
    if (sample.b) {
      annotateObservation(cells?.[2], sample.b);
    }
  });
}
function counterText(value: number | null | undefined): string {
  return value == null ? "Unknown" : String(value);
}
function annotateObservation(
  cell: HTMLTableCellElement | undefined,
  point: ReturnType<typeof counterAtTime>,
): void {
  if (!cell) {
    return;
  }
  const note = cell.ownerDocument.createElement("small");
  const age = point.ageMs === null ? "" : `${point.ageMs.toFixed(2)} ms old`;
  note.textContent = point.value === null ? `${point.note}${age ? ` · ${age}` : ""}` : age;
  const change = point.change;
  const delta = change.value === null ? "Unknown" : `${change.value > 0 ? "+" : ""}${change.value}`;
  const changeText = `Δ prev ${delta} · ${change.note}`;
  const deltaLabel = cell.ownerDocument.createElement("span");
  deltaLabel.className = "jank-viewer-counter-delta";
  deltaLabel.textContent = `Δ prev ${delta}${change.skippedSamples ? ` · ${change.skippedSamples} invalid` : ""}`;
  deltaLabel.title = changeText;
  if (change.value === null) {
    note.textContent += ` · ${change.note}`;
  }
  cell.title = `${counterText(point.value)} · ${point.note} · ${age} · ${changeText}${change.intervalMs === null ? "" : ` · over ${change.intervalMs} ms`}`;
  cell.classList.toggle("jank-viewer-unknown", point.value === null);
  const value = cell.ownerDocument.createElement("span");
  value.className = "jank-viewer-counter-value";
  value.textContent = counterText(point.value);
  cell.replaceChildren(value, deltaLabel, note);
}

function isCurrent(point: ReturnType<typeof counterAtTime>): boolean {
  return point.value !== null && point.ageMs === 0;
}
function counterLabel(lane: CounterLane, model: CounterTimeline): string {
  return model.lanes.filter((candidate) => candidate.identity.name === lane.identity.name).length >
    1
    ? `${lane.identity.channelId} / ${lane.identity.name}`
    : lane.identity.name;
}
function scaleLabel(value: number): string {
  const absolute = Math.abs(value);
  return absolute >= 10000 || (absolute > 0 && absolute < 0.01)
    ? value.toExponential(1)
    : String(value);
}
