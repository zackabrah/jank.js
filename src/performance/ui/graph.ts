import type {
  DiagnosticEvent,
  DiagnosticFrame,
} from "../../core/recording-types.ts";

import { eventGlyph } from "../../core/inspection.ts";

import { msPerSecond } from "../../core/recording.ts";

import { shorten } from "./format.ts";

const maxPixelRatio = 3;

/** Label plates: padding either side of the text, height and text baseline. */
const platePadding = 3;

const plateHeight = 14;

const plateBaseline = 11;

/** Bar area top when labels draw above it: a row of labels, then a row for the ▾ marker. */
const labelledTop = 24;

/** The ▾ marker sits in its own row, below the labels, so no label ever covers it. */
const markerBaseline = 23;

/** Dotted guide rows and the dots along them. */
const guideSpacing = 20;

const dotSpacing = 10;

/** The bar scale always fits at least this many budgets. */
const budgetHeadroom = 3;

/** Centres a 1 px line on a pixel row. */
const pixelCentre = 0.5;

const dashLength = 4;

const budgetDash = [dashLength, dashLength];

/** Budget value plate, above the budget line. */
const budgetLabelLift = 15;

/** Event icons below the bars: their baseline, and the space kept between neighbours. */
const glyphBaseline = 12;

const glyphGap = 2;

/** Space between the worst-frame label and the newest event's label above the bars. */
const labelGap = 8;

/** Approximate label character width, in px. */
const labelCharWidth = 6;

const thumbnailPitch = 3;

export interface GraphTheme {
  ink: string;
  line: string;
  graph: string;
  faint: string;
  dim: string;
  muted: string;
  soft: string;
  text: string;
  bright: string;
  miss: string;
  font: string;
}

/** Read once per mode change, never per frame; computed style forces a style pass. */
export function graphTheme(element: Element): GraphTheme {
  const style = getComputedStyle(element);

  /** A CSS custom property's value, or the fallback when it's unset. */
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  return {
    ink: token("--jank-ink", "#0a0a0a"),
    line: token("--jank-line", "#1f1f1f"),
    graph: token("--jank-graph", "#333333"),
    faint: token("--jank-faint", "#6a6a6a"),
    dim: token("--jank-dim", "#7a7a7a"),
    muted: token("--jank-muted", "#a3a3a3"),
    soft: token("--jank-soft", "#d4d4d4"),
    text: token("--jank-text", "#e8e8e8"),
    bright: token("--jank-bright", "#ffffff"),
    miss: token("--jank-miss", "#f26032"),
    font: token("--jank-font", "monospace"),
  };
}

/** Match the backing store to the device pixel ratio and return a CSS-pixel context. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const ratio = Math.min(
    maxPixelRatio,
    Math.max(1, globalThis.devicePixelRatio || 1),
  );

  const pixelWidth = Math.round(width * ratio),
    pixelHeight = Math.round(height * ratio);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext("2d");

  if (!context) return null;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  return context;
}

/** Text on an ink plate so labels stay legible over bars and guides. */
export function plate(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  const width = context.measureText(text).width;

  context.fillStyle = theme.ink;
  context.fillRect(x - platePadding, y, width + 2 * platePadding, plateHeight);
  context.fillStyle = color;
  context.fillText(text, x, y + plateBaseline);

  return width;
}

export interface FrameGraph {
  /** Visible width. The bars canvas is `margin` wider, with the extra hidden off its left. */
  width: number;
  /** Bars drawn beyond the left edge, so the bars can glide between redraws without a gap. */
  margin: number;
  /** Height of the bar area; event ticks and labels draw below it. */
  height: number;
  pitch: number;
  bar: number;
  /** Budget value and worst-frame labels. */
  labels: boolean;
  budgetColor: string;
}

/**
 * Newest frame at the right edge; orange beyond `limitMs`, the budget plus timer precision.
 * Bars, the budget line and markers go on `context`, which can move; labels go on `text`,
 * which never does. Without `text`, labels share the bars canvas.
 */
export function drawFrameGraph(
  context: CanvasRenderingContext2D,
  text: CanvasRenderingContext2D | null,
  theme: GraphTheme,
  frames: readonly DiagnosticFrame[],
  budgetMs: number,
  limitMs: number,
  graph: FrameGraph,
  events: readonly DiagnosticEvent[] = [],
) {
  const { width, margin, height, pitch, bar } = graph;

  const full = width + margin;

  const count = Math.min(frames.length, Math.floor(width / pitch)),
    drawn = Math.min(frames.length, Math.floor(full / pitch));

  // The worst frame is judged over what's visible; the hidden margin only feeds the glide.
  const first = frames.length - count,
    drawnFirst = frames.length - drawn;

  let worst = first;

  // Ties go to the newest frame: it's the one worth pointing at, and it sits clear of the
  // fixed label in the top-left corner.
  for (let i = first; i < frames.length; i++)
    if (frames[i]!.interval >= frames[worst]!.interval) worst = i;

  const top = graph.labels ? labelledTop : 2;

  const peak = frames[worst]?.interval ?? 0;

  let tallest = peak;

  for (let i = drawnFirst; i < first; i++)
    tallest = Math.max(tallest, frames[i]!.interval);

  if (graph.labels) {
    context.fillStyle = theme.line;

    for (let y = guideSpacing / 2; y < height; y += guideSpacing)
      for (let dot = 0; dot < full; dot += dotSpacing)
        context.fillRect(dot, y, 1, 1);
  }

  // The tallest drawn bar, margin included, fits below the labels; nothing is clipped as the
  // bars glide.
  const scale =
    height /
    Math.max(budgetMs * budgetHeadroom, (tallest * height) / (height - top));

  /** Left edge of frame i's bar, right-aligned so the newest frame ends at the canvas edge. */
  const x = (i: number) => full - (frames.length - i) * pitch + (pitch - bar);

  for (let i = drawnFirst; i < frames.length; i++) {
    const frame = frames[i]!;

    if (frame.interval > limitMs) context.fillStyle = theme.miss;
    else
      context.fillStyle = i === frames.length - 1 ? theme.bright : theme.graph;

    const h = Math.max(1, Math.round(frame.interval * scale));

    context.fillRect(x(i), height - h, bar, h);
  }

  const budgetY = Math.round(height - budgetMs * scale) + pixelCentre;

  context.lineWidth = 1;

  strokeBudgetLine(context, budgetY, 0, full, graph.budgetColor);

  if (!graph.labels || !count) return;

  // Labels are placed in the visible width; on the bars canvas that starts after the margin.
  const label = text ?? context,
    shift = text ? 0 : margin;

  context.font = label.font = `10px ${theme.font}`;

  const budgetText = budgetMs.toFixed(1);

  plate(
    label,
    theme,
    budgetText,
    shift + width - label.measureText(budgetText).width - platePadding,
    budgetY - budgetLabelLift,
    theme.muted,
  );

  // Text stays put while the bars scroll; only the markers move with their frames.
  const worstColor = peak > limitMs ? theme.miss : theme.muted;

  const marker = "▾";

  context.fillStyle = worstColor;
  context.fillText(
    marker,
    x(worst) + (bar - context.measureText(marker).width) / 2,
    markerBaseline,
  );

  const worstWidth = plate(
    label,
    theme,
    `worst ${peak.toFixed(1)}`,
    shift + platePadding,
    0,
    worstColor,
  );

  // Each event's icon sits under the frame that contains it; where icons would overlap the
  // newer one wins. The newest event is named in a fixed place, opposite the worst frame.
  const start = frames[drawnFirst]!.at - frames[drawnFirst]!.interval,
    end = frames.at(-1)!.at;

  const marks: { label: string; at: number; tick: number }[] = [];

  let frame = drawnFirst;

  for (const event of events) {
    if (event.at < start || event.at > end) continue;

    while (frame < frames.length - 1 && frames[frame]!.at < event.at) frame++;

    marks.push({ label: event.label, at: event.at, tick: x(frame) + bar / 2 });
  }

  const newest = marks.at(-1);

  if (!newest) return;

  // Left edge of the last icon drawn, scanning from the newest backwards.
  let free = Infinity;

  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]!;

    const { glyph } = eventGlyph(mark.label);

    const half = context.measureText(glyph).width / 2;

    // Kept inside the canvas, so an icon at either edge is never cut in half.
    const left = Math.min(full - 2 * half, Math.max(0, mark.tick - half));

    if (left + 2 * half > free) continue;

    context.fillStyle = mark === newest ? theme.text : theme.muted;
    context.fillText(glyph, left, height + glyphBaseline);

    free = left - glyphGap;
  }

  const { glyph, text: name } = eventGlyph(newest.label);

  const age = ` · ${((end - newest.at) / msPerSecond).toFixed(1)} s ago`;

  const room =
    Math.floor(
      (width - worstWidth - 2 * platePadding - labelGap) / labelCharWidth,
    ) -
    age.length -
    glyph.length -
    1;

  const caption = `${glyph} ${shorten(name.toLowerCase(), Math.max(0, room))}${age}`;

  plate(
    label,
    theme,
    caption,
    shift + width - label.measureText(caption).width - platePadding,
    0,
    theme.muted,
  );
}

/** Fixed thumbnail for one capture: the trigger and its neighbours. */
export function drawThumbnail(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  intervals: readonly number[],
  limitMs: number,
  width: number,
  height: number,
) {
  const peak = Math.max(limitMs * 2, ...intervals);

  intervals.forEach((value, i) => {
    context.fillStyle = value > limitMs ? theme.miss : theme.graph;

    const h = Math.max(1, Math.round((value / peak) * height));

    context.fillRect(
      width - (intervals.length - i) * thumbnailPitch + 1,
      height - h,
      2,
      h,
    );
  });
}

/** Strokes the dashed budget line at `y` from `from` to `to`, then clears the dash. */
export function strokeBudgetLine(
  context: CanvasRenderingContext2D,
  y: number,
  from: number,
  to: number,
  color: string,
) {
  context.strokeStyle = color;
  context.setLineDash(budgetDash);
  context.beginPath();
  context.moveTo(from, y);
  context.lineTo(to, y);
  context.stroke();
  context.setLineDash([]);
}
