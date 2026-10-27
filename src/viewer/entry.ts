import { createRecordingViewModel } from "./model.ts";

import { MAX_RECORDING_BYTES, serializeRecording } from "../core/recording.ts";

import {
  buildLanes,
  environmentLine,
  eventsNear,
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
  fixed,
  observedTick,
  shorten,
} from "../performance/ui/format.ts";

import {
  graphTheme,
  prepareCanvas,
  type GraphTheme,
} from "../performance/ui/graph.ts";

import type { PerformanceRecording } from "../core/recording-types.ts";

import "./viewer.css";

// The jank.js viewer. Offline: it reads files, drops and its opener's handoff, and
// never fetches. Host-provided strings are written as text, never as HTML.
document.documentElement.classList.add("jank-viewer");

const app = document.querySelector<HTMLElement>("#app")!;

app.innerHTML = `<header class="jank-viewer-top"><h1 class="jank-viewer-brand"><span class="jank-viewer-word">JANK.JS</span><span class="jank-viewer-dim jank-viewer-tracked">VIEWER</span></h1><span class="jank-viewer-dim">/</span><span class="jank-viewer-file" data-k="file">no recording</span><span class="jank-viewer-chip" title="nothing is fetched or uploaded">OFFLINE</span><span class="jank-viewer-push"><label class="jank-viewer-btn" for="recording-file">OPEN</label><input id="recording-file" class="jank-viewer-picker" type="file" accept=".json,application/json" aria-label="Recording file"><button type="button" class="jank-viewer-btn" data-action="export" disabled>EXPORT</button></span></header>
<p class="jank-viewer-env"><span data-k="env">open a recording exported by the panel</span><span data-k="totals"></span></p>
<div class="jank-viewer-empty" data-k="empty"><p>drop a recording here, or OPEN one.</p><p class="jank-viewer-dim">nothing leaves this machine.</p></div>
<section class="jank-viewer-session" aria-label="Session overview" data-k="session-box" hidden><div class="jank-viewer-side"><span class="jank-viewer-tracked jank-viewer-muted">SESSION</span><span class="jank-viewer-dim" data-k="bucket"></span></div><canvas data-k="session" aria-hidden="true"></canvas></section>
<div class="jank-viewer-main" data-k="main" hidden><div class="jank-viewer-left"><div class="jank-viewer-timeline" tabindex="0" role="slider" aria-label="Playhead" data-k="slider"><canvas data-k="timeline" aria-hidden="true"></canvas></div>
<section class="jank-viewer-captures" aria-label="Captures"><h2 class="jank-viewer-h"><span class="jank-viewer-tracked">CAPTURES</span><span class="jank-viewer-dim" data-k="rule"></span></h2><div role="table" aria-label="Captures" data-k="capture-table"><div role="rowgroup"><div role="row" class="jank-viewer-sr"><span role="columnheader">rank</span><span role="columnheader">frame</span><span role="columnheader">frame time</span><span role="columnheader">nearest event</span><span role="columnheader">open</span></div></div><div data-k="capture-rows" role="rowgroup"></div></div><p class="jank-viewer-dim jank-viewer-pad" data-k="capture-empty" hidden>no frame crossed the threshold in this recording.</p></section></div>
<aside class="jank-viewer-inspector" aria-label="Frame inspector"><div class="jank-viewer-ihead"><span class="jank-viewer-chip jank-viewer-on" data-k="i-frame"></span><span class="jank-viewer-push jank-viewer-dim"><span data-k="i-capture"></span><button type="button" class="jank-viewer-icon" data-action="prev-capture" aria-label="Previous capture">◂</button><button type="button" class="jank-viewer-icon" data-action="next-capture" aria-label="Next capture">▸</button></span></div>
<p class="jank-viewer-headline"><span><b data-k="i-ms"></b><span class="jank-viewer-muted"> ms</span></span><span class="jank-viewer-muted" data-k="i-ratio"></span></p><p class="jank-viewer-dim" data-k="i-over"></p>
<p class="jank-viewer-likely" data-k="i-likely-row"><span class="jank-viewer-tag" title="a heuristic: the scope furthest above its own median across this recording">LIKELY</span><b data-k="i-likely"></b><span class="jank-viewer-muted" data-k="i-likely-delta"></span></p>
<section><h2 class="jank-viewer-h"><span class="jank-viewer-tracked">CPU</span><span class="jank-viewer-dim jank-viewer-legend"><i class="jank-viewer-solid"></i>exact</span></h2><div data-k="i-cpu"></div></section>
<section><h2 class="jank-viewer-h"><span class="jank-viewer-tracked">GPU</span><span class="jank-viewer-dim jank-viewer-legend"><i class="jank-viewer-dashed"></i><span data-k="i-gpu-meta"></span></span></h2><div data-k="i-gpu"></div></section>
<section><h2 class="jank-viewer-h"><span class="jank-viewer-tracked">COUNTERS</span><span class="jank-viewer-dim" data-k="i-counter-meta"></span></h2><div class="jank-viewer-grid" data-k="i-counters"></div></section>
<section><h2 class="jank-viewer-h"><span class="jank-viewer-tracked">EVENTS</span><span class="jank-viewer-dim">within 10 frames</span></h2><div data-k="i-events"></div></section>
<p class="jank-viewer-legend-text">solid: measured in this frame<br>dashed: periodic or delayed sample<br>unattributed frame interval: browser work, scheduling, waiting or idle, not only uninstrumented code</p>
<div class="jank-viewer-actions"><button type="button" class="jank-viewer-btn jank-viewer-primary" data-action="export-capture">EXPORT CAPTURE</button><button type="button" class="jank-viewer-btn" data-action="copy-frame">COPY FRAME</button></div></aside></div>
<footer class="jank-viewer-status"><span><i class="jank-viewer-mark"></i><b data-k="s-frame">FRAME –</b><span class="jank-viewer-muted" data-k="s-range"></span></span><span class="jank-viewer-push"><span role="alert" data-k="error"></span><span class="jank-viewer-dim" role="status" data-k="s-format">no recording open</span></span></footer>`;

const slot = (key: string) =>
  app.querySelector<HTMLElement>(`[data-k="${key}"]`)!;

const surface = (key: string) =>
  app.querySelector<HTMLCanvasElement>(`canvas[data-k="${key}"]`)!;

const action = (name: string) =>
  app.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;

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
  RIGHT = 44;

let recording: PerformanceRecording | null = null,
  lanes: Lanes | null = null,
  marks: CaptureMark[] = [],
  text = "",
  name = "",
  selected = 0,
  start = 0,
  theme: GraphTheme | undefined,
  sessionWidth = 1270,
  timelineWidth = 1000,
  queued = false;

const inViewCount = () =>
  Math.max(1, Math.floor((timelineWidth - LEFT - RIGHT) / PITCH));

/** The panel's over-budget rule: the budget plus two timer ticks, set on load. */
let limitMs = 0;

const limit = () => limitMs;

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

  start = Math.max(0, selected - (inViewCount() >> 1));

  renderStatic();

  update();
}

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
        element("span", "jank-viewer-dim", `#${mark.rank}`),
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

  if (center || selected < start || selected >= start + visible)
    start =
      selected - (center ? visible >> 1 : selected < start ? 0 : visible - 1);

  clampStart();

  update();
}

function clampStart() {
  if (!recording) return;

  start = Math.max(0, Math.min(recording.frames.length - inViewCount(), start));
}

function update() {
  if (queued) return;

  queued = true;

  requestAnimationFrame(() => {
    queued = false;

    if (!recording || !lanes) return;

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

function drawSession(
  data: PerformanceRecording,
  info: Lanes,
  colors: GraphTheme,
) {
  const canvas = surface("session");

  const width = sessionWidth,
    height = 96,
    top = 16,
    tall = 60;

  const context = prepareCanvas(canvas, width, height);

  if (!context) return;

  const n = info.intervals.length;

  const bucket = Math.max(1, Math.ceil(n / Math.floor(width / 2)));

  const buckets = Math.ceil(n / bucket);

  const step = width / buckets;

  slot("bucket").textContent = `peak per ${bucket} fr`;

  const ceiling = data.budget.frameMs * 3;

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

  const x = (at: number) => (at / bucket) * step;

  const budgetY = Math.round(top + tall - data.budget.frameMs * scale) + 0.5;

  context.strokeStyle = colors.muted;

  context.setLineDash([4, 4]);

  context.beginPath();

  context.moveTo(0, budgetY);

  context.lineTo(width, budgetY);

  context.stroke();

  context.setLineDash([]);

  context.font = `10px ${colors.font}`;

  let free = -Infinity;

  for (const mark of marks.toSorted((a, b) => a.at - b.at)) {
    const at = Math.round(x(mark.at));

    context.fillStyle = colors.miss;

    context.fillRect(at, 4, 1, 8);

    if (at + 4 < free) continue;

    context.fillText(`#${mark.rank}`, at + 4, 11);

    free = at + 4 + context.measureText(`#${mark.rank}`).width + 6;
  }

  const left = Math.round(x(start)),
    right = Math.round(x(Math.min(n, start + inViewCount())));

  context.strokeStyle = colors.text;

  context.strokeRect(
    left + 0.5,
    top - 2.5,
    Math.max(3, right - left),
    tall + 4,
  );

  context.fillStyle = colors.text;

  context.fillRect(left - 1, top + 24, 3, 12);

  context.fillRect(right - 1, top + 24, 3, 12);

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

    context.fillText(label, labelX, top + tall + 16);

    free = labelX + context.measureText(label).width + 8;
  }
}

interface Row {
  label: string;
  dim?: boolean;
  values: Float64Array;
  scale: number;
  dashed?: boolean;
}

function drawTimeline(
  data: PerformanceRecording,
  info: Lanes,
  colors: GraphTheme,
) {
  const canvas = surface("timeline");

  const visible = inViewCount();

  const end = Math.min(info.intervals.length, start + visible);

  const x = (at: number) => LEFT + (at - start) * PITCH;

  const range = (values: Float64Array) => {
    let peak = 0;

    for (let i = start; i < end; i++) if (values[i]! > peak) peak = values[i]!;

    return peak;
  };

  // CPU lanes share one scale, the budget, so heights compare across lanes and
  // recordings; a taller value is capped bright. The tool's own cost is drawn ×20.
  const cpuScale = data.budget.frameMs;

  const gpuScale = Math.max(5, ...info.gpu.map((lane) => range(lane.values)));

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
          label: "jank.js ×20",
          dim: true,
          values: info.overhead.map((value) => value * 20),
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
    18 +
    120 +
    18 +
    30 +
    sections.reduce(
      (sum, section) => sum + 28 + Math.max(1, section.rows.length) * 28,
      0,
    ) +
    8;

  if (canvas.style.height !== `${height}px`)
    canvas.style.height = `${height}px`;

  const context = prepareCanvas(canvas, timelineWidth, height);

  if (!context) return;

  const playhead = x(selected);

  context.fillStyle = colors.line;

  context.fillRect(playhead - 0.5, 18, PITCH, height - 18);

  context.font = `600 10px ${colors.font}`;

  const chip = count(data.frames[selected]!.id);

  context.fillStyle = colors.text;

  context.fillText(
    chip,
    playhead + 1 - context.measureText(chip).width / 2,
    13,
  );

  // Frame time
  const top = 18,
    tall = 120;

  let peak = 0;

  for (let i = start; i < end; i++) peak = Math.max(peak, info.intervals[i]!);

  const scale = tall / Math.max(data.budget.frameMs * 3, peak * 1.05);

  context.font = `12px ${colors.font}`;

  context.fillStyle = colors.muted;

  context.fillText("frame time", 20, top + 14);

  context.font = `11px ${colors.font}`;

  context.fillStyle = colors.dim;

  context.fillText("ms", 20, top + 34);

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
    playhead - 1.5,
    top + tall - selectedHeight - 2.5,
    BAR + 3,
    selectedHeight + 3,
  );

  const budgetY = Math.round(top + tall - data.budget.frameMs * scale) + 0.5;

  context.strokeStyle = colors.text;

  context.setLineDash([4, 4]);

  context.beginPath();

  context.moveTo(LEFT, budgetY);

  context.lineTo(LEFT + visible * PITCH, budgetY);

  context.stroke();

  context.setLineDash([]);

  context.font = `10px ${colors.font}`;

  context.fillStyle = colors.muted;

  context.fillText(
    fixed(data.budget.frameMs),
    LEFT + visible * PITCH + 6,
    budgetY + 4,
  );

  context.fillStyle = colors.dim;

  const axis = Math.max(10, axisStep(visible));

  let free = -Infinity;

  for (let i = start; i < end; i++) {
    const id = info.ids[i]!;

    if (i !== start && i !== end - 1 && id % axis) continue;

    const label = count(id);

    const width = context.measureText(label).width;

    const labelX = Math.min(x(i), LEFT + visible * PITCH - width);

    if (labelX < free) continue;

    context.fillText(label, labelX, top + tall + 14);

    free = labelX + width + 10;
  }

  // Events: labelled ticks, never overlapping, never cut mid-word.
  let y = top + tall + 18;

  context.font = `12px ${colors.font}`;

  context.fillStyle = colors.muted;

  context.fillText("events", 20, y + 15);

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
      label: event.label,
    });
  }

  free = -Infinity;

  ticks.forEach((tick, i) => {
    context.fillStyle = tick.here ? colors.text : colors.muted;

    context.fillRect(tick.at, y + 4, 1, 14);

    const next = ticks.slice(i + 1).find((later) => later.at > tick.at)?.at;

    const edge = next ?? LEFT + visible * PITCH;

    const label = shorten(tick.label, Math.floor((edge - tick.at - 12) / 6.6));

    if (!label || tick.at + 6 < free) return;

    context.fillText(label, tick.at + 6, y + 15);

    free = tick.at + 6 + context.measureText(label).width + 10;
  });

  y += 30;

  for (const section of sections) {
    context.font = `11px ${colors.font}`;

    context.fillStyle = colors.muted;

    context.fillText(section.title, 20, y + 16);

    const titleWidth = context.measureText(section.title).width;

    context.fillStyle = colors.dim;

    context.fillText(section.legend, 20 + titleWidth + 12, y + 16);

    y += 28;

    if (!section.rows.length) {
      context.fillText(section.empty ?? "", LEFT, y + 16);

      y += 28;

      continue;
    }

    for (const row of section.rows) {
      context.font = `12px ${colors.font}`;

      context.fillStyle = row.dim ? colors.dim : colors.muted;

      context.fillText(
        shorten(row.label, 18) || row.label.slice(0, 18),
        20,
        y + 16,
      );

      context.fillStyle = colors.line;

      context.fillRect(LEFT, y + 24, visible * PITCH, 1);

      for (let i = start; i < end; i++) {
        const value = row.values[i]!;

        if (Number.isNaN(value)) continue;

        const h = Math.max(
          1,
          Math.min(24, Math.round((value / row.scale) * 24)),
        );

        const on = i === selected;

        if (row.dashed) {
          context.strokeStyle = on ? colors.bright : colors.faint;

          context.strokeRect(x(i) + 0.5, y + 24 - h + 0.5, BAR - 1, h - 1);
        } else {
          context.fillStyle = on
            ? row.dim
              ? colors.muted
              : colors.bright
            : row.dim
              ? colors.line
              : colors.graph;

          context.fillRect(x(i), y + 24 - h, BAR, h);

          if (value > row.scale) {
            context.fillStyle = colors.bright;

            context.fillRect(x(i), y, BAR, 1);
          }
        }
      }

      y += 28;
    }
  }
}

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

function counterLegend(data: PerformanceRecording) {
  const times = data.samples.map((sample) => sample.at);

  const gaps = times
    .slice(1)
    .map((value, i) => value - times[i]!)
    .toSorted((a, b) => a - b);

  const sources = [
    ...new Set(
      data.samples
        .flatMap((sample) => sample.systems)
        .filter((system) => Object.keys(system.values).length)
        .map((system) => system.label.split(" ")[0]!.toLowerCase()),
    ),
  ];

  return [
    ...sources,
    gaps.length
      ? `sampled every ${Math.round(gaps[gaps.length >> 1]!)} ms`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function leaderRow(label: string, value: string, fraction: number, kind = "") {
  const row = element("div", `jank-viewer-row-k ${kind}`);

  const fill = element("i");

  fill.style.width = `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;

  const lead = element("span", "jank-viewer-lead");

  lead.append(fill);

  row.append(
    element("span", "jank-viewer-k", label),
    lead,
    element("span", "jank-viewer-v", value),
  );

  return row;
}

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

  if (frame.coverage === "unavailable")
    cpu.push(element("p", "jank-viewer-dim", "not recorded"));
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

    if (frame.coverage === "truncated")
      cpu.push(
        element(
          "p",
          "jank-viewer-dim",
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
            "jank-viewer-dim",
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
                "jank-viewer-dim",
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
      ? cells.slice(0, 12)
      : [element("p", "jank-viewer-dim", "not recorded")]),
  );

  const events = eventsNear(data, selected);

  slot("i-events").replaceChildren(
    ...(events.length
      ? events.map((event) => {
          const row = element("div", "jank-viewer-event");

          row.append(
            element(
              "span",
              "jank-viewer-dim jank-viewer-offset",
              event.offset > 0 ? `+${event.offset}` : String(event.offset),
            ),
            element(
              "span",
              event.offset ? "jank-viewer-muted" : "",
              event.label,
            ),
          );

          if (event.detail) row.title = event.detail;

          return row;
        })
      : [element("p", "jank-viewer-dim", "no events")]),
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

function stepCapture(direction: 1 | -1) {
  if (!marks.length) return;

  const ranked = marks.toSorted((a, b) => a.rank - b.rank);

  const current = ranked.findIndex((mark) => mark.at === selected);

  const next =
    current < 0
      ? direction > 0
        ? 0
        : ranked.length - 1
      : (current + direction + ranked.length) % ranked.length;

  select(ranked[next]!.at, true);
}

function download(json: string, file: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );

  const a = document.createElement("a");

  a.href = url;

  a.download = file;

  a.click();

  URL.revokeObjectURL(url);
}

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

  const step = event.shiftKey ? 10 : 1;

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

  const at = start + Math.floor((event.clientX - bounds.left - LEFT) / PITCH);

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

session.addEventListener("pointerup", () => {
  dragging = null;

  if (recording) model.selectFrame(recording.frames[selected]!.id);
});

new ResizeObserver(() => {
  sessionWidth = Math.max(200, Math.floor(session.clientWidth || sessionWidth));

  timelineWidth = Math.max(
    LEFT + RIGHT + 40,
    Math.floor(slot("timeline").clientWidth || timelineWidth),
  );

  clampStart();

  update();
}).observe(app);

let generation = 0;

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
      data.type !== "jank.js:recording" ||
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
