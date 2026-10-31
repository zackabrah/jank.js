import type { FrameSample } from "../core/frames.ts";

/** Offline window: each bar is one sealed frame; selection and budget are independent of refresh cadence. */
export function drawRecordingChart(
  canvas: HTMLCanvasElement,
  chart: { frames: readonly FrameSample[]; budgetMs: number; selectedFrameId: number | null },
): void {
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
  const maximum = Math.max(
    chart.budgetMs * 2,
    ...chart.frames.map((frame) => frame.endedAtMs - frame.startedAtMs),
  );
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const column = width / Math.max(1, chart.frames.length);
  for (const [index, frame] of chart.frames.entries()) {
    const duration = frame.endedAtMs - frame.startedAtMs;
    const barHeight = Math.max(1, (duration / maximum) * (height - 18));
    context.fillStyle = color(
      duration > chart.budgetMs ? "--jank-warning" : "--jl-muted",
      "#a3a3a3",
    );
    context.fillRect(index * column, height - barHeight, Math.max(1, column - 1), barHeight);
    if (frame.id === chart.selectedFrameId) {
      context.strokeStyle = color("--jl-text", "#ffffff");
      context.strokeRect(index * column + 0.5, 0.5, Math.max(1, column - 1), height - 1);
    }
  }
  const budgetY = height - (chart.budgetMs / maximum) * (height - 18);
  context.strokeStyle = color("--jl-text", "#ffffff");
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(0, budgetY);
  context.lineTo(width, budgetY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = color("--jl-text", "#ffffff");
  context.font = "11px monospace";
  context.fillText(`Budget ${chart.budgetMs.toFixed(2)} ms`, 4, Math.max(12, budgetY - 4));
  canvas.setAttribute(
    "aria-label",
    `${chart.frames.length} sealed frame durations; budget ${chart.budgetMs.toFixed(2)} milliseconds; selected frame ${chart.selectedFrameId ?? "none"}. Orange bars exceed the exact budget.`,
  );
}
