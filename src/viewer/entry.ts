import { buildLabel } from "../core/build-info.ts";

import { createRecordingViewModel } from "./model.ts";

import { MAX_RECORDING_BYTES, serializeRecording } from "../core/recording.ts";

import { eventsNear, iconLabel } from "../core/inspection.ts";

import { compactMarkup, download, findIn } from "../performance/ui/dom.ts";

import markup from "./markup.html?raw";

import {
  buildLanes,
  environmentLine,
  findCaptures,
  likelyScope,
  primaryCounters,
  span,
  frames as framesText,
  type CaptureMark,
  type Lane,
  type Lanes,
} from "./lanes.ts";

import {
  axisStep,
  budgetLimit,
  count,
  counter,
  counterSources,
  fixed,
  observedTick,
  shorten,
} from "../performance/ui/format.ts";

import {
  graphTheme,
  prepareCanvas,
  strokeBudgetLine,
  type GraphTheme,
} from "../performance/ui/graph.ts";

import type { PerformanceRecording } from "../core/recording-types.ts";

import "./viewer.css";

// The jank.js viewer. Offline: it reads files, drops and its opener's handoff, and
// never fetches. Host-provided strings are written as text, never as HTML.
document.documentElement.classList.add("jank-viewer", "jl");

const app = document.querySelector<HTMLElement>("#app")!;

app.innerHTML = compactMarkup(markup);

/** The element bound to a data-k key in the viewer markup. */
const slot = (key: string) => findIn(app, `[data-k="${key}"]`, HTMLElement);

/** The canvas bound to a data-k key. */
const surface = (key: string) =>
  findIn(app, `canvas[data-k="${key}"]`, HTMLCanvasElement);

/** The button bound to a data-action name. */
const action = (name: string) =>
  findIn(app, `[data-action="${name}"]`, HTMLButtonElement);

slot("build-info").textContent = buildLabel;

/** Creates an element with an optional class and text. */
const element = (tag: string, className = "", text = "") => {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text) node.textContent = text;

  return node;
};

const model = createRecordingViewModel();

const PITCH = 4,
  BAR = 3,
  LEFT = 160,
  RIGHT = 44,
  LABEL_X = 20,
  MIN_PLOT_WIDTH = 40,
  MIN_SESSION_WIDTH = 200,
  DEFAULT_SESSION_WIDTH = 1270,
  DEFAULT_TIMELINE_WIDTH = 1000,
  HALF_PIXEL = 0.5,
  /** Graphs show at least this many budgets of headroom. */
  CEILING_BUDGETS = 3;

const SHIFT_STEP = 10,
  MAX_COUNTERS = 12,
  PERCENT = 100;

const UNAVAILABLE = "unavailable",
  TRUNCATED = "truncated",
  RECORDING_MESSAGE = "jank.js:recording";

let recording: PerformanceRecording | null = null,
  lanes: Lanes | null = null,
  marks: CaptureMark[] = [],
  text = "",
  name = "",
  selected = 0,
  start = 0,
  theme: GraphTheme | undefined,
  sessionWidth = DEFAULT_SESSION_WIDTH,
  timelineWidth = DEFAULT_TIMELINE_WIDTH,
  queued = false;

/** How many frames fit across the timeline plot at its current width. */
const inViewCount = () =>
  Math.max(1, Math.floor((timelineWidth - LEFT - RIGHT) / PITCH));

/** The panel's over-budget rule: the budget plus two timer ticks, set on load. */
let limitMs = 0;

/** The open recording's over-budget threshold in ms; opening a recording changes it. */
const limit = () => limitMs;

/** Opens recording JSON at its worst capture; a parse error is shown and the current recording kept. */
function load(source: string, file: string) {
  try {
    model.load(source);
  } catch (caught) {
    slot("error").textContent =
      caught instanceof Error ? caught.message : "Unable to read recording";

    return;
  }

  recording = model.recording();

  if (!recording) return;

  text = source;

  name = file;

  lanes = buildLanes(recording);

  limitMs = budgetLimit(
    recording.budget.frameMs,
    recording.metadata.environment.cpuTimer.estimatedResolutionMs ??
      observedTick(lanes.intervals.toSorted()),
  );

  marks = findCaptures(recording).marks;

  slot("error").textContent = "";

  // Open on the worst capture, or on the first frame when nothing crossed the threshold.
  selected = marks.find((mark) => mark.rank === 1)?.at ?? 0;

  renderStatic();

  measureSurfaces();

  start = Math.max(0, selected - (inViewCount() >> 1));

  update();
}

/** Fills what only changes when a recording opens: header, totals and the capture list. */
function renderStatic() {
  if (!recording || !lanes) return;

  const migrated = recording.metadata.importedFromVersion === 1;

  slot("file").textContent = name;
  slot("file").title = name;
  slot("env").textContent = environmentLine(recording, lanes);
  slot("totals").textContent =
    `${framesText(recording.frames.length)} · ${span(recording)} · ${marks.length} captures`;
  slot("s-format").textContent =
    `format ${migrated ? "1, migrated" : String(recording.version)} · validated on open`;
  slot("rule").textContent = findCaptures(recording).rule;
  slot("empty").hidden = true;
  slot("main").hidden = slot("session-box").hidden = false;

  action("export").disabled = false;

  const rows = marks
    .toSorted((a, b) => a.rank - b.rank)
    .map((mark) => {
      const row = element("div", "jank-viewer-row");

      row.setAttribute("role", "row");
      row.dataset["frame"] = String(mark.at);

      const ms = element("span", "jank-viewer-miss", `${fixed(mark.ms)} ms`);

      if (mark.ms <= limit()) ms.className = "";

      const go = element("button", "jank-viewer-link", "OPEN");

      go.setAttribute("aria-label", `Open capture ${mark.rank}`);
      go.addEventListener("click", () => select(mark.at, true));

      const open = element("span", "jank-viewer-end");

      open.append(go);

      for (const cell of [
        element("span", "jl-dim", `#${mark.rank}`),
        element("span", "", count(recording!.frames[mark.at]!.id)),
        ms,
        element("span", "jank-viewer-muted", mark.near),
        open,
      ]) {
        cell.setAttribute("role", "cell");

        row.append(cell);
      }

      return row;
    });

  slot("capture-rows").replaceChildren(...rows);
  slot("capture-table").hidden = !rows.length;
  slot("capture-empty").hidden = rows.length > 0;
}

/** Move the playhead; the visible range follows it. */
function select(at: number, center = false) {
  if (!recording) return;

  selected = Math.max(0, Math.min(recording.frames.length - 1, at));

  model.selectFrame(recording.frames[selected]!.id);

  const visible = inViewCount();

  if (center) start = selected - (visible >> 1);
  else if (selected < start) start = selected;
  else if (selected >= start + visible) start = selected - (visible - 1);

  clampStart();

  update();
}

/** Keeps the in-view range inside the recording. */
function clampStart() {
  if (!recording) return;

  start = Math.max(0, Math.min(recording.frames.length - inViewCount(), start));
}

/**
 * The canvases are hidden until a recording opens. Observe and measure their
 * own layout, which can change without resizing the outer app.
 */
function measureSurfaces() {
  const nextSession = Math.max(
    MIN_SESSION_WIDTH,
    Math.floor(surface("session").clientWidth || sessionWidth),
  );

  const nextTimeline = Math.max(
    LEFT + RIGHT + MIN_PLOT_WIDTH,
    Math.floor(surface("timeline").clientWidth || timelineWidth),
  );

  const changed =
    nextSession !== sessionWidth || nextTimeline !== timelineWidth;

  sessionWidth = nextSession;

  timelineWidth = nextTimeline;

  return changed;
}

/** Schedules one redraw on the next animation frame; calls before then are merged. */
function update() {
  if (queued) return;

  queued = true;

  requestAnimationFrame(() => {
    queued = false;

    if (!recording || !lanes) return;

    measureSurfaces();

    clampStart();

    theme ??= graphTheme(document.documentElement);

    drawSession(recording, lanes, theme);

    drawTimeline(recording, lanes, theme);

    renderInspector(recording, lanes);

    const frame = recording.frames[selected]!;

    const last = Math.min(recording.frames.length, start + inViewCount()) - 1;

    slot("s-frame").textContent = `FRAME ${count(frame.id)}`;
    slot("s-range").textContent =
      `range ${count(recording.frames[start]!.id)} to ${count(recording.frames[last]!.id)} · ${PITCH} px per frame`;

    const slider = slot("slider");

    slider.setAttribute("aria-valuemin", String(recording.frames[0]!.id));
    slider.setAttribute("aria-valuemax", String(recording.frames.at(-1)!.id));
    slider.setAttribute("aria-valuenow", String(frame.id));
    slider.setAttribute(
      "aria-valuetext",
      `frame ${count(frame.id)}, ${fixed(frame.interval)} ms${frame.interval > limit() ? ", over budget" : ""}`,
    );

    for (const row of slot("capture-rows").children)
      if (row instanceof HTMLElement)
        row.toggleAttribute(
          "data-on",
          row.dataset["frame"] === String(selected),
        );
  });
}

/** The whole-recording strip: frame times, capture marks and the in-view range. */
function drawSession(
  data: PerformanceRecording,
  info: Lanes,
  colors: GraphTheme,
) {
  const canvas = surface("session");

  const width = sessionWidth,
    height = 96,
    top = 16,
    tall = 60,
    markTop = 4,
    markHeight = 8,
    markLabelX = 4,
    markBaseline = 11,
    markGap = 6,
    rangePad = 2,
    minRangeWidth = 3,
    axisBaseline = 16,
    axisGap = 8;

  const context = prepareCanvas(canvas, width, height);

  if (!context) return;

  const n = info.intervals.length;

  const bucket = Math.max(1, Math.ceil(n / Math.floor(width / 2)));

  const buckets = Math.ceil(n / bucket);

  const step = width / buckets;

  slot("bucket").textContent = `peak per ${bucket} fr`;

  const ceiling = data.budget.frameMs * CEILING_BUDGETS;

  const scale = tall / ceiling;

  for (let b = 0; b < buckets; b++) {
    let peak = 0;

    for (let i = b * bucket; i < Math.min(n, (b + 1) * bucket); i++)
      peak = Math.max(peak, info.intervals[i]!);

    context.fillStyle = peak > limit() ? colors.miss : colors.graph;

    const h = Math.max(1, Math.min(tall, Math.round(peak * scale)));

    const left = Math.floor(b * step);

    const barWidth = Math.max(1, Math.floor((b + 1) * step) - left);

    context.fillRect(left, top + tall - h, barWidth, h);

    // Taller than the strip: a bright cap says the bar is cut, the timeline has it whole.
    if (peak > ceiling) {
      context.fillStyle = colors.bright;
      context.fillRect(left, top, barWidth, 1);
    }
  }

  /** Frame index to x on the session strip. */
  const x = (at: number) => (at / bucket) * step;

  const budgetY =
    Math.round(top + tall - data.budget.frameMs * scale) + HALF_PIXEL;

  strokeBudgetLine(context, budgetY, 0, width, colors.muted);

  context.font = `10px ${colors.font}`;

  let free = -Infinity;

  for (const mark of marks.toSorted((a, b) => a.at - b.at)) {
    const at = Math.round(x(mark.at));

    context.fillStyle = colors.miss;
    context.fillRect(at, markTop, 1, markHeight);

    if (at + markLabelX < free) continue;

    context.fillText(`#${mark.rank}`, at + markLabelX, markBaseline);

    free =
      at + markLabelX + context.measureText(`#${mark.rank}`).width + markGap;
  }

  const left = Math.round(x(start)),
    right = Math.round(x(Math.min(n, start + inViewCount())));

  context.strokeStyle = colors.text;
  context.strokeRect(
    left + HALF_PIXEL,
    top - (rangePad + HALF_PIXEL),
    Math.max(minRangeWidth, right - left),
    tall + 2 * rangePad,
  );

  const tick = axisStep(Math.max(1, info.ids.at(-1)! - info.ids[0]!));

  context.fillStyle = colors.dim;

  free = -Infinity;

  for (
    let id = Math.ceil(info.ids[0]! / tick) * tick;
    id <= info.ids.at(-1)!;
    id += tick
  ) {
    const at = info.index.get(id);

    if (at === undefined) continue;

    const label = count(id);

    const labelX = Math.min(
      width - context.measureText(label).width,
      Math.round(x(at)),
    );

    if (labelX < free) continue;

    context.fillText(label, labelX, top + tall + axisBaseline);

    free = labelX + context.measureText(label).width + axisGap;
  }
}

interface Row {
  label: string;
  dim?: boolean;
  values: Float64Array;
  scale: number;
  dashed?: boolean;
}

/** The zoomed timeline: frame-time graph, axis and events, then the CPU, GPU and counter lanes. */
function drawTimeline(
  data: PerformanceRecording,
  info: Lanes,
  colors: GraphTheme,
) {
  const canvas = surface("timeline");

  // Frame time graph, axis, events row, then sections of lane rows.
  const top = 18,
    tall = 120,
    axisRow = 18,
    eventsRow = 30,
    rowHeight = 28,
    laneHeight = 24,
    bottom = 8,
    chipBaseline = 13,
    titleBaseline = 14,
    unitBaseline = 34,
    axisBaseline = 14,
    rowBaseline = 16,
    eventBaseline = 15,
    legendGap = 12,
    labelGap = 10,
    budgetLabelX = 6,
    budgetLabelY = 4,
    minAxisStep = 10,
    minGpuScaleMs = 5,
    peakHeadroom = 1.05,
    overheadZoom = 20,
    tickTop = 4,
    tickHeight = 14,
    tickLabelX = 6,
    tickPadding = 12,
    outlineLeft = 1.5,
    outlineTop = 2.5,
    outlineGrow = 3,
    /** Approximate width of one 11px character. */
    charWidth = 6.6,
    maxLabelChars = 18;

  const visible = inViewCount();

  const end = Math.min(info.intervals.length, start + visible);

  /** Frame index to x in the timeline plot. */
  const x = (at: number) => LEFT + (at - start) * PITCH;

  /** The peak of a lane's values among the frames in view. */
  const range = (values: Float64Array) => {
    let peak = 0;

    for (let i = start; i < end; i++) if (values[i]! > peak) peak = values[i]!;

    return peak;
  };

  // CPU lanes share one scale, the budget, so heights compare across lanes and
  // recordings; a taller value is capped bright. The tool's own cost is drawn ×20.
  const cpuScale = data.budget.frameMs;

  const gpuScale = Math.max(
    minGpuScaleMs,
    ...info.gpu.map((lane) => range(lane.values)),
  );

  const counters = primaryCounters(info);

  const sections: {
    title: string;
    legend: string;
    rows: Row[];
    empty?: string;
  }[] = [
    {
      title: "CPU",
      legend: "exact per frame · nested and overlapping scopes counted once",
      rows: [
        ...info.cpu.map((lane) => ({
          label: lane.label.toLowerCase(),
          values: lane.values,
          scale: cpuScale,
        })),
        {
          label: "unattributed",
          dim: true,
          values: info.unattributed,
          scale: cpuScale,
        },
        {
          label: `jank.js ×${overheadZoom}`,
          dim: true,
          values: info.overhead.map((value) => value * overheadZoom),
          scale: cpuScale,
        },
      ],
    },
    {
      title: "GPU",
      legend: gpuLegend(info),
      rows: info.gpu.map((lane) => ({
        label: lane.label.toLowerCase(),
        values: lane.values,
        scale: gpuScale,
        dashed: true,
      })),
      empty: "not recorded",
    },
    {
      title: "COUNTERS",
      legend: counterLegend(data),
      rows: counters.map((lane: Lane) => ({
        label: lane.label,
        values: lane.values,
        scale: Math.max(1, range(lane.values)),
        dashed: true,
      })),
      empty: "not recorded",
    },
  ];

  const height =
    top +
    tall +
    axisRow +
    eventsRow +
    sections.reduce(
      (sum, section) =>
        sum + rowHeight + Math.max(1, section.rows.length) * rowHeight,
      0,
    ) +
    bottom;

  if (canvas.style.height !== `${height}px`)
    canvas.style.height = `${height}px`;

  const context = prepareCanvas(canvas, timelineWidth, height);

  if (!context) return;

  const playhead = x(selected);

  context.fillStyle = colors.line;
  context.fillRect(playhead - HALF_PIXEL, top, PITCH, height - top);
  context.font = `600 10px ${colors.font}`;

  const chip = count(data.frames[selected]!.id);

  context.fillStyle = colors.text;
  context.fillText(
    chip,
    playhead + 1 - context.measureText(chip).width / 2,
    chipBaseline,
  );

  // Frame time
  let peak = 0;

  for (let i = start; i < end; i++) peak = Math.max(peak, info.intervals[i]!);

  const scale =
    tall / Math.max(data.budget.frameMs * CEILING_BUDGETS, peak * peakHeadroom);

  context.font = `12px ${colors.font}`;
  context.fillStyle = colors.muted;
  context.fillText("frame time", LABEL_X, top + titleBaseline);
  context.font = `11px ${colors.font}`;
  context.fillStyle = colors.dim;
  context.fillText("ms", LABEL_X, top + unitBaseline);

  for (let i = start; i < end; i++) {
    const value = info.intervals[i]!;

    const h = Math.max(1, Math.round(value * scale));

    context.fillStyle = value > limitMs ? colors.miss : colors.graph;
    context.fillRect(x(i), top + tall - h, BAR, h);
  }

  const selectedHeight = Math.max(
    1,
    Math.round(info.intervals[selected]! * scale),
  );

  context.strokeStyle = colors.bright;
  context.strokeRect(
    playhead - outlineLeft,
    top + tall - selectedHeight - outlineTop,
    BAR + outlineGrow,
    selectedHeight + outlineGrow,
  );

  const budgetY =
    Math.round(top + tall - data.budget.frameMs * scale) + HALF_PIXEL;

  strokeBudgetLine(context, budgetY, LEFT, LEFT + visible * PITCH, colors.text);

  context.font = `10px ${colors.font}`;
  context.fillStyle = colors.muted;
  context.fillText(
    fixed(data.budget.frameMs),
    LEFT + visible * PITCH + budgetLabelX,
    budgetY + budgetLabelY,
  );
  context.fillStyle = colors.dim;

  const axis = Math.max(minAxisStep, axisStep(visible));

  let free = -Infinity;

  for (let i = start; i < end; i++) {
    const id = info.ids[i]!;

    if (i !== start && i !== end - 1 && id % axis) continue;

    const label = count(id);

    const width = context.measureText(label).width;

    const labelX = Math.min(x(i), LEFT + visible * PITCH - width);

    if (labelX < free) continue;

    context.fillText(label, labelX, top + tall + axisBaseline);

    free = labelX + width + labelGap;
  }

  // Events: labelled ticks, never overlapping, never cut mid-word.
  let y = top + tall + axisRow;

  context.font = `12px ${colors.font}`;
  context.fillStyle = colors.muted;
  context.fillText("events", LABEL_X, y + eventBaseline);
  context.font = `11px ${colors.font}`;

  // Ticks first; each label then ends before the next tick, losing whole words if it must.
  let frame = start;

  const first = data.frames[start]!;

  const ticks: { at: number; here: boolean; label: string }[] = [];

  for (const event of data.events) {
    if (
      event.at < first.at - first.interval ||
      event.at > data.frames[end - 1]!.at
    )
      continue;

    while (frame < end - 1 && data.frames[frame]!.at < event.at) frame++;

    ticks.push({
      at: x(frame) + 1,
      here: frame === selected,
      label: iconLabel(event.label),
    });
  }

  free = -Infinity;

  ticks.forEach((tick, i) => {
    context.fillStyle = tick.here ? colors.text : colors.muted;
    context.fillRect(tick.at, y + tickTop, 1, tickHeight);

    const next = ticks.slice(i + 1).find((later) => later.at > tick.at)?.at;

    const edge = next ?? LEFT + visible * PITCH;

    const label = shorten(
      tick.label,
      Math.floor((edge - tick.at - tickPadding) / charWidth),
    );

    if (!label || tick.at + tickLabelX < free) return;

    context.fillText(label, tick.at + tickLabelX, y + eventBaseline);

    free = tick.at + tickLabelX + context.measureText(label).width + labelGap;
  });

  y += eventsRow;

  for (const section of sections) {
    context.font = `11px ${colors.font}`;
    context.fillStyle = colors.muted;
    context.fillText(section.title, LABEL_X, y + rowBaseline);

    const titleWidth = context.measureText(section.title).width;

    context.fillStyle = colors.dim;
    context.fillText(
      section.legend,
      LABEL_X + titleWidth + legendGap,
      y + rowBaseline,
    );

    y += rowHeight;

    if (!section.rows.length) {
      context.fillText(section.empty ?? "", LEFT, y + rowBaseline);

      y += rowHeight;

      continue;
    }

    for (const row of section.rows) {
      const fill = row.dim ? colors.line : colors.graph,
        selectedFill = row.dim ? colors.muted : colors.bright;

      context.font = `12px ${colors.font}`;
      context.fillStyle = row.dim ? colors.dim : colors.muted;
      context.fillText(
        shorten(row.label, maxLabelChars) || row.label.slice(0, maxLabelChars),
        LABEL_X,
        y + rowBaseline,
      );
      context.fillStyle = colors.line;
      context.fillRect(LEFT, y + laneHeight, visible * PITCH, 1);

      for (let i = start; i < end; i++) {
        const value = row.values[i]!;

        if (Number.isNaN(value)) continue;

        const h = Math.max(
          1,
          Math.min(laneHeight, Math.round((value / row.scale) * laneHeight)),
        );

        const on = i === selected;

        if (row.dashed) {
          context.strokeStyle = on ? colors.bright : colors.faint;
          context.strokeRect(
            x(i) + HALF_PIXEL,
            y + laneHeight - h + HALF_PIXEL,
            BAR - 1,
            h - 1,
          );
        } else {
          context.fillStyle = on ? selectedFill : fill;
          context.fillRect(x(i), y + laneHeight - h, BAR, h);

          if (value > row.scale) {
            context.fillStyle = colors.bright;
            context.fillRect(x(i), y, BAR, 1);
          }
        }
      }

      y += rowHeight;
    }
  }
}

/** The GPU lanes' caption: sampling cadence and how samples were placed. */
function gpuLegend(info: Lanes) {
  if (!info.gpu.length) return "";

  const at: number[] = [];

  info.gpuAge.forEach((age, i) => {
    if (
      !Number.isNaN(age) ||
      info.gpu.some((lane) => !Number.isNaN(lane.values[i]!))
    )
      at.push(i);
  });

  const gaps = at
    .slice(1)
    .map((value, i) => value - at[i]!)
    .toSorted((a, b) => a - b);

  const cadence = gaps.length ? gaps[gaps.length >> 1]! : 0;

  return [
    "renderer",
    cadence
      ? `every ${cadence === 1 ? "" : `${cadence}th `}frame`
      : "one sample",
    "placed at source frame",
    "stale reuse dropped",
    ...(info.gpuUnlinked ? [`${info.gpuUnlinked} unlinked`] : []),
  ].join(" · ");
}

/** The counters' caption: their sources and median sample interval. */
function counterLegend(data: PerformanceRecording) {
  const times = data.samples.map((sample) => sample.at);

  const gaps = times
    .slice(1)
    .map((value, i) => value - times[i]!)
    .toSorted((a, b) => a - b);

  return [
    ...counterSources(data.samples.flatMap((sample) => sample.systems)),
    gaps.length
      ? `sampled every ${Math.round(gaps[gaps.length >> 1]!)} ms`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An inspector row: label, a bar filled to `fraction`, and the value. */
function leaderRow(label: string, value: string, fraction: number, kind = "") {
  const row = element("div", `jank-viewer-row-k ${kind}`);

  const fill = element("i");

  fill.style.width = `${(Math.min(1, Math.max(0, fraction)) * PERCENT).toFixed(1)}%`;

  const lead = element("span", "jank-viewer-lead");

  lead.append(fill);

  row.append(
    element("span", "jank-viewer-k", label),
    lead,
    element("span", "jank-viewer-v", value),
  );

  return row;
}

/** Fills the inspector with the selected frame's timings, scopes, counters and events. */
function renderInspector(data: PerformanceRecording, info: Lanes) {
  const frame = data.frames[selected]!;

  const budget = data.budget.frameMs;

  const over = frame.interval > limit();

  slot("i-frame").textContent = `FRAME ${count(frame.id)}`;

  const rank = marks.find((mark) => mark.at === selected)?.rank;

  slot("i-capture").textContent = `capture ${rank ?? "–"} / ${marks.length}`;

  const ms = slot("i-ms");

  ms.textContent = fixed(frame.interval);
  ms.dataset["tone"] = over ? "miss" : "";

  slot("i-ratio").textContent =
    `${(frame.interval / budget).toFixed(1)}× budget`;
  slot("i-over").textContent =
    frame.interval > budget
      ? `+${fixed(frame.interval - budget)} ms over ${fixed(budget)}`
      : `${fixed(budget - frame.interval)} ms under ${fixed(budget)}`;

  const likely = likelyScope(info, selected);

  slot("i-likely-row").hidden = !likely;
  slot("i-likely").textContent = likely?.label.toLowerCase() ?? "";
  slot("i-likely-delta").textContent = likely
    ? `+${fixed(likely.delta)} ms vs median`
    : "";

  const cpu: HTMLElement[] = [];

  if (frame.coverage === UNAVAILABLE)
    cpu.push(element("p", "jl-dim", "not recorded"));
  else {
    for (const lane of info.cpu) {
      const value = lane.values[selected]!;

      cpu.push(
        leaderRow(
          lane.label.toLowerCase(),
          fixed(value),
          value / frame.interval,
          lane.id === likely?.id ? "jank-viewer-hl" : "",
        ),
      );
    }

    cpu.push(
      leaderRow(
        "jank.js",
        fixed(info.overhead[selected]!),
        info.overhead[selected]! / frame.interval,
        "jank-viewer-quiet",
      ),
      leaderRow(
        "unattributed",
        fixed(info.unattributed[selected]!),
        info.unattributed[selected]! / frame.interval,
        "jank-viewer-quiet",
      ),
    );

    if (frame.coverage === TRUNCATED)
      cpu.push(
        element(
          "p",
          "jl-dim",
          `${frame.droppedScopes} scopes omitted; unattributed includes them`,
        ),
      );
  }

  slot("i-cpu").replaceChildren(...cpu);

  const samples =
    data.gpu?.samples.filter((sample) => sample.diagnosticFrame === frame.id) ??
    [];

  const age = samples[0]?.sampleAgeFrames;

  slot("i-gpu-meta").textContent = samples.length
    ? `this frame${age == null ? "" : ` · resolved ${age} frames later`}`
    : "";
  slot("i-gpu").replaceChildren(
    ...(samples.length
      ? samples.flatMap((sample) =>
          sample.passes.map((pass) =>
            leaderRow(
              pass.label.toLowerCase(),
              pass.milliseconds === null ? "unknown" : fixed(pass.milliseconds),
              (pass.milliseconds ?? 0) / frame.interval,
              "jank-viewer-dash",
            ),
          ),
        )
      : [
          element(
            "p",
            "jl-dim",
            data.gpu ? "no sample from this frame" : "not recorded",
          ),
        ]),
  );

  const index = data.samples.findLastIndex((sample) => sample.at <= frame.at);

  const sample = data.samples[index],
    previous = data.samples[index - 1];

  slot("i-counter-meta").textContent = sample
    ? `vs previous sample · ${fixed(frame.at - sample.at, 0)} ms old`
    : "";

  const before = new Map(
    previous?.systems.flatMap((system) =>
      Object.entries(system.values).map(([key, value]) => [
        `${system.id}:${key}`,
        value,
      ]),
    ),
  );

  const cells = sample
    ? sample.systems.flatMap((system) =>
        Object.entries(system.values).map(([key, value]) => {
          const cell = element("div", "jank-viewer-kv");

          const shown = element("span", "", counter(value));

          const old = before.get(`${system.id}:${key}`);

          if (
            typeof value === "number" &&
            typeof old === "number" &&
            value !== old
          )
            shown.append(
              element(
                "span",
                "jl-dim",
                ` ${value > old ? "+" : ""}${counter(value - old)}`,
              ),
            );

          cell.append(
            element(
              "span",
              "jank-viewer-muted",
              key.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(),
            ),
            shown,
          );

          return cell;
        }),
      )
    : [];

  slot("i-counters").replaceChildren(
    ...(cells.length
      ? cells.slice(0, MAX_COUNTERS)
      : [element("p", "jl-dim", "not recorded")]),
  );

  const events = eventsNear(data, selected);

  slot("i-events").replaceChildren(
    ...(events.length
      ? events.map((event) => {
          const row = element("div", "jank-viewer-event");

          row.append(
            element(
              "span",
              "jl-dim jank-viewer-offset",
              event.offset > 0 ? `+${event.offset}` : String(event.offset),
            ),
            element(
              "span",
              event.offset ? "jank-viewer-muted" : "",
              iconLabel(event.label),
            ),
          );

          if (event.detail) row.title = event.detail;

          return row;
        })
      : [element("p", "jl-dim", "no events")]),
  );

  action("export-capture").disabled = !captureAround();
}

/** The capture whose kept window holds the playhead. */
function captureAround() {
  if (!recording) return undefined;

  const { beforeFrames, afterFrames } = recording.capture;

  return marks.find(
    (mark) =>
      selected >= mark.at - beforeFrames && selected <= mark.at + afterFrames,
  );
}

/** Jumps to the next or previous capture in rank order, wrapping around. */
function stepCapture(direction: 1 | -1) {
  if (!marks.length) return;

  const ranked = marks.toSorted((a, b) => a.rank - b.rank);

  const current = ranked.findIndex((mark) => mark.at === selected);

  let next = direction > 0 ? 0 : ranked.length - 1;

  if (current >= 0)
    next = (current + direction + ranked.length) % ranked.length;

  select(ranked[next]!.at, true);
}

/** The open file's name without .json, for naming exports. */
const base = () => name.replace(/\.json$/i, "") || "jank-recording";

action("export").addEventListener("click", () => {
  if (text) download(text, name || "jank-recording.json");
});
action("export-capture").addEventListener("click", () => {
  const mark = captureAround();

  if (!recording || !mark) return;

  const { beforeFrames, afterFrames } = recording.capture;

  const kept = recording.frames.slice(
    Math.max(0, mark.at - beforeFrames),
    mark.at + afterFrames + 1,
  );

  const from = kept[0]!.at - kept[0]!.interval,
    to = kept.at(-1)!.at;

  const ids = new Set(kept.map((frame) => frame.id));

  try {
    download(
      serializeRecording({
        ...recording,
        capture: { ...recording.capture, triggerFrame: mark.id },
        frames: kept,
        samples: recording.samples.filter(
          (entry) => entry.at >= from && entry.at <= to,
        ),
        events: recording.events.filter(
          (entry) => entry.at >= from && entry.at <= to,
        ),
        ...(recording.gpu
          ? {
              gpu: {
                ...recording.gpu,
                samples: recording.gpu.samples.filter(
                  (entry) =>
                    entry.diagnosticFrame != null &&
                    ids.has(entry.diagnosticFrame),
                ),
              },
            }
          : {}),
      }),
      `${base()}-capture-${mark.rank}.json`,
    );
  } catch (caught) {
    slot("error").textContent =
      caught instanceof Error ? caught.message : "capture export failed";
  }
});
action("copy-frame").addEventListener("click", () => {
  if (!recording) return;

  const frame = recording.frames[selected]!;

  const json = JSON.stringify(
    {
      frame,
      gpu:
        recording.gpu?.samples.filter(
          (sample) => sample.diagnosticFrame === frame.id,
        ) ?? [],
    },
    null,
    2,
  );

  navigator.clipboard
    .writeText(json)
    .then(
      () =>
        (slot("s-format").textContent =
          `frame ${count(frame.id)} copied as JSON`),
    )
    .catch(
      () =>
        (slot("error").textContent =
          "clipboard unavailable here; use EXPORT CAPTURE"),
    );
});
action("prev-capture").addEventListener("click", () => stepCapture(-1));
action("next-capture").addEventListener("click", () => stepCapture(1));

const slider = slot("slider");

slider.addEventListener("keydown", (event) => {
  if (!recording) return;

  const step = event.shiftKey ? SHIFT_STEP : 1;

  const visible = inViewCount();

  const moves: Record<string, () => void> = {
    ArrowRight: () => select(selected + step),
    ArrowLeft: () => select(selected - step),
    Home: () => select(start),
    End: () =>
      select(Math.min(recording!.frames.length - 1, start + visible - 1)),
    "]": () => stepCapture(1),
    "[": () => stepCapture(-1),
  };

  const move = moves[event.key];

  if (!move) return;

  event.preventDefault();

  move();
});

slot("timeline").addEventListener("click", (event) => {
  if (!recording) return;

  const bounds = slot("timeline").getBoundingClientRect();

  const x = ((event.clientX - bounds.left) / bounds.width) * timelineWidth;

  const at = start + Math.floor((x - LEFT) / PITCH);

  if (
    at >= start &&
    at < Math.min(recording.frames.length, start + inViewCount())
  )
    select(at);

  slider.focus();
});

// Session strip: click centres the range there; dragging the range moves it.
const session = surface("session");

let dragging: number | null = null;

/** The frame index under the pointer on the session strip. */
const sessionFrame = (event: PointerEvent) => {
  const bounds = session.getBoundingClientRect();

  const n = lanes?.ids.length ?? 1;

  return Math.round(((event.clientX - bounds.left) / bounds.width) * n);
};

session.addEventListener("pointerdown", (event) => {
  if (!recording) return;

  const at = sessionFrame(event);

  const visible = inViewCount();

  dragging = at >= start && at < start + visible ? at - start : visible >> 1;

  start = at - dragging;

  clampStart();

  session.setPointerCapture(event.pointerId);
  session.style.cursor = "grabbing";

  update();
});
session.addEventListener("pointermove", (event) => {
  if (dragging === null || !recording) return;

  start = sessionFrame(event) - dragging;

  clampStart();

  if (selected < start || selected >= start + inViewCount())
    selected = Math.max(start, Math.min(start + inViewCount() - 1, selected));

  update();
});

/** Ends a session-strip drag and commits the selected frame to the model. */
function endSessionDrag() {
  dragging = null;

  session.style.removeProperty("cursor");

  if (recording) model.selectFrame(recording.frames[selected]!.id);
}

session.addEventListener("pointerup", endSessionDrag);
session.addEventListener("pointercancel", endSessionDrag);
session.addEventListener("lostpointercapture", endSessionDrag);

const resize = new ResizeObserver(() => {
  if (!measureSurfaces()) return;

  clampStart();

  update();
});

resize.observe(session);
resize.observe(surface("timeline"));

let generation = 0;

/** Opens a chosen file, rejecting oversized ones; when opens overlap, only the latest loads. */
async function openFile(file: File | undefined) {
  if (!file) return;

  const current = ++generation;

  if (file.size > MAX_RECORDING_BYTES) {
    slot("error").textContent = "Recording exceeds the 32 MiB import limit";

    return;
  }

  try {
    const source = await file.text();

    if (current === generation) load(source, file.name);
  } catch {
    if (current === generation)
      slot("error").textContent = "Unable to read this file";
  }
}

const picker = app.querySelector<HTMLInputElement>("#recording-file")!;

picker.addEventListener("change", () => void openFile(picker.files?.[0]));

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();

  void openFile(event.dataTransfer?.files[0]);
});

// Handoff from the panel's OPEN IN VIEWER: only the window that opened this one is heard.
if (window.opener) {
  addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data;

    if (
      event.source !== window.opener ||
      typeof data !== "object" ||
      data === null ||
      !("type" in data) ||
      data.type !== RECORDING_MESSAGE ||
      !("json" in data) ||
      typeof data.json !== "string"
    )
      return;

    load(
      data.json,
      "name" in data && typeof data.name === "string"
        ? data.name
        : "jank-recording.json",
    );
  });

  const opener: WindowProxy = window.opener;

  opener.postMessage({ type: "jank.js:viewer-ready" }, "*");
}
