import type {
  DiagnosticEvent,
  DiagnosticFrame,
} from "../../core/recording-types.ts";

import { shorten } from "./format.ts";

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
  const ratio = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));

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

  context.fillRect(x - 3, y, width + 6, 14);

  context.fillStyle = color;

  context.fillText(text, x, y + 11);

  return width;
}

export interface FrameGraph {
  width: number;
  /** Height of the bar area; event ticks and labels draw below it. */
  height: number;
  pitch: number;
  bar: number;
  /** Budget value and worst-frame labels. */
  labels: boolean;
  budgetColor: string;
}

/** Newest frame at the right edge; orange beyond `limitMs`, the budget plus timer precision. */
export function drawFrameGraph(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  frames: readonly DiagnosticFrame[],
  budgetMs: number,
  limitMs: number,
  graph: FrameGraph,
  events: readonly DiagnosticEvent[] = [],
) {
  const { width, height, pitch, bar } = graph;

  const count = Math.min(frames.length, Math.floor(width / pitch));

  const first = frames.length - count;

  let worst = first;

  for (let i = first; i < frames.length; i++)
    if (frames[i]!.interval > frames[worst]!.interval) worst = i;

  const top = graph.labels ? 16 : 2;

  const peak = frames[worst]?.interval ?? 0;

  if (graph.labels) {
    // Dotted guide rows every 20 px.
    context.fillStyle = theme.line;

    for (let y = 10; y < height; y += 20)
      for (let dot = 0; dot < width; dot += 10) context.fillRect(dot, y, 1, 1);
  }

  // The tallest bar always fits below the worst label; nothing is clipped.
  const scale =
    height / Math.max(budgetMs * 3, (peak * height) / (height - top));

  const x = (i: number) => width - (frames.length - i) * pitch + (pitch - bar);

  for (let i = first; i < frames.length; i++) {
    const frame = frames[i]!;

    context.fillStyle =
      frame.interval > limitMs
        ? theme.miss
        : i === frames.length - 1
          ? theme.bright
          : theme.graph;

    const h = Math.max(1, Math.round(frame.interval * scale));

    context.fillRect(x(i), height - h, bar, h);
  }

  const budgetY = Math.round(height - budgetMs * scale) + 0.5;

  context.strokeStyle = graph.budgetColor;

  context.lineWidth = 1;

  context.setLineDash([4, 4]);

  context.beginPath();

  context.moveTo(0, budgetY);

  context.lineTo(width, budgetY);

  context.stroke();

  context.setLineDash([]);

  if (!graph.labels || !count) return;

  context.font = `10px ${theme.font}`;

  const budgetText = budgetMs.toFixed(1);

  plate(
    context,
    theme,
    budgetText,
    width - context.measureText(budgetText).width - 3,
    budgetY - 15,
    theme.muted,
  );

  const worstText = `${peak.toFixed(1)} ▾`;

  const worstWidth = context.measureText(worstText).width;

  plate(
    context,
    theme,
    worstText,
    Math.min(
      width - worstWidth - 3,
      Math.max(3, x(worst) + bar - worstWidth + 3),
    ),
    0,
    peak > limitMs ? theme.miss : theme.muted,
  );

  // Ticks at the frame that contains each event; labels never overlap or split a word.
  const start = frames[first]!.at - frames[first]!.interval;

  let free = 0,
    frame = first;

  for (const event of events) {
    if (event.at < start || event.at > frames.at(-1)!.at) continue;

    while (frame < frames.length - 1 && frames[frame]!.at < event.at) frame++;

    const tick = x(frame) + (bar >> 1);

    context.fillStyle = theme.muted;

    context.fillRect(tick, height, 1, 6);

    const room = Math.floor((width - tick - 4) / 6);

    const label = shorten(event.label.toLowerCase(), Math.max(0, room));

    if (!label || tick + 4 < free) continue;

    context.fillStyle = theme.dim;

    context.fillText(label, tick + 4, height + 15);

    free = tick + 4 + context.measureText(label).width + 8;
  }
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

    context.fillRect(width - (intervals.length - i) * 3 + 1, height - h, 2, h);
  });
}
