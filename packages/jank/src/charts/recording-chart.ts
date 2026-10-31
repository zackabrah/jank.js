import type { FrameSample } from "../core/frames.ts";

interface TimelineWindow {
  originMs: number;
  fromMs: number;
  toMs: number;
  selectedMs: number;
}
interface RecordingChart {
  frames: readonly FrameSample[];
  budgetMs: number;
  selectedFrameId: number | null;
  maximumMs?: number;
  timeline?: TimelineWindow | undefined;
  visible?: boolean;
  overlay?: { frames: readonly FrameSample[]; originMs: number; visible: boolean } | undefined;
  overview?: { fromMs: number; toMs: number };
}

/** Each bar is one sealed frame; A/B share scales but retain independent frame boundaries. */
export function drawRecordingChart(canvas: HTMLCanvasElement, chart: RecordingChart): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }
  const window = canvas.ownerDocument.defaultView;
  const ratio = Math.min(3, window?.devicePixelRatio ?? 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const style = window?.getComputedStyle(canvas);
  const color = (key: string, fallback: string) => style?.getPropertyValue(key).trim() || fallback;
  let maximum = Math.max(chart.budgetMs * 2, chart.maximumMs ?? 0);
  for (const frame of [...chart.frames, ...(chart.overlay?.frames ?? [])]) {
    maximum = Math.max(maximum, frame.endedAtMs - frame.startedAtMs);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const geometry = { width, height, maximum };
  if (chart.visible !== false) {
    drawFrames(context, chart, geometry, {
      normal: color(chart.overlay ? "--jank-series-a" : "--jl-muted", "#a3a3a3"),
      warning: color("--jank-warning", "#f26032"),
      overlay: Boolean(chart.overlay),
      dashed: false,
    });
  }
  if (chart.overlay?.visible) {
    drawFrames(
      context,
      {
        ...chart,
        frames: chart.overlay.frames,
        timeline: chart.timeline
          ? { ...chart.timeline, originMs: chart.overlay.originMs }
          : undefined,
      },
      geometry,
      {
        normal: color("--jank-series-b", "#c4a1ff"),
        warning: "",
        overlay: true,
        dashed: true,
      },
    );
  }
  context.setLineDash([]);
  context.strokeStyle = color("--jl-text", "#ffffff");
  context.fillStyle = context.strokeStyle;
  drawGuides(context, chart, geometry);
  canvas.setAttribute(
    "aria-label",
    `${chart.frames.length} sealed frame durations; budget ${chart.budgetMs.toFixed(2)} milliseconds; selected frame ${chart.selectedFrameId ?? "none"}. ${chart.overlay ? "A cyan solid, B violet dashed; shared time and height scales. Missing frames are gaps." : "Orange bars exceed the exact budget."}`,
  );
}

function drawFrames(
  context: CanvasRenderingContext2D,
  chart: RecordingChart,
  geometry: { width: number; height: number; maximum: number },
  colors: { normal: string; warning: string; overlay: boolean; dashed: boolean },
): void {
  const { width, height, maximum } = geometry;
  const column = width / Math.max(1, chart.frames.length);
  context.setLineDash(colors.dashed ? [3, 2] : []);
  for (const [index, frame] of chart.frames.entries()) {
    const duration = frame.endedAtMs - frame.startedAtMs;
    const barHeight = Math.max(1, (duration / maximum) * (height - 18));
    const { x, right } = frameBarBounds(frame, index, { timeline: chart.timeline, width, column });
    if (right <= x) {
      continue;
    }
    context.fillStyle =
      !colors.overlay && duration > chart.budgetMs ? colors.warning : colors.normal;
    context.strokeStyle = colors.normal;
    if (!colors.dashed) {
      context.globalAlpha = colors.overlay ? 0.3 : 1;
      context.fillRect(x, height - barHeight, Math.max(1, right - x - 1), barHeight);
      context.globalAlpha = 1;
    }
    if (colors.overlay) {
      context.strokeRect(x + 0.5, height - barHeight, Math.max(1, right - x - 1), barHeight);
    }
  }
}
function drawGuides(
  context: CanvasRenderingContext2D,
  chart: RecordingChart,
  geometry: { width: number; height: number; maximum: number },
): void {
  const { width, height, maximum } = geometry;
  const budgetY = height - (chart.budgetMs / maximum) * (height - 18);
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(0, budgetY);
  context.lineTo(width, budgetY);
  context.stroke();
  context.setLineDash([]);
  context.font = "10px monospace";
  context.fillText(`${chart.budgetMs.toFixed(2)} ms budget`, 4, Math.max(12, budgetY - 4));
  const timeline = chart.timeline;
  if (!timeline) {
    return;
  }
  const x = (time: number) =>
    ((time - timeline.fromMs) / (timeline.toMs - timeline.fromMs)) * width;
  if (chart.overview) {
    context.globalAlpha = 0.08;
    context.fillRect(
      x(chart.overview.fromMs),
      0,
      x(chart.overview.toMs) - x(chart.overview.fromMs),
      height,
    );
    context.globalAlpha = 1;
    context.strokeRect(
      x(chart.overview.fromMs) + 0.5,
      0.5,
      x(chart.overview.toMs) - x(chart.overview.fromMs) - 1,
      height - 1,
    );
  }
  context.beginPath();
  context.moveTo(x(timeline.selectedMs), 0);
  context.lineTo(x(timeline.selectedMs), height);
  context.stroke();
}
function frameBarBounds(
  frame: FrameSample,
  index: number,
  geometry: { timeline: TimelineWindow | undefined; width: number; column: number },
) {
  const { timeline, width, column } = geometry;
  if (!timeline) {
    return { x: index * column, right: (index + 1) * column };
  }
  const position = (atMs: number) =>
    ((atMs - timeline.originMs - timeline.fromMs) / (timeline.toMs - timeline.fromMs)) * width;
  return {
    x: Math.max(0, position(frame.startedAtMs)),
    right: Math.min(width, position(frame.endedAtMs)),
  };
}
