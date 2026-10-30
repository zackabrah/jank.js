import type { FrameSample } from "../core/frames.ts";

export interface FrameChart {
  readonly frames: readonly FrameSample[];
  readonly budgetMs: number;
  readonly limitMs: number;
}

/** Drawing only: the caller owns refresh cadence and supplies sealed observations. */
export function drawFrameChart(canvas: HTMLCanvasElement, chart: FrameChart): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) {
    return;
  }
  const window = canvas.ownerDocument.defaultView;
  const scale = Math.min(3, window?.devicePixelRatio ?? 1);
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const theme = window?.getComputedStyle(canvas);
  const frames = chart.frames.slice(-Math.floor(width / 2));
  const maximumMs = Math.max(
    chart.budgetMs * 2,
    ...frames.map((frame) => frame.endedAtMs - frame.startedAtMs),
  );
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  frames.forEach((frame, index) => {
    const durationMs = frame.endedAtMs - frame.startedAtMs;
    context.fillStyle =
      durationMs > chart.limitMs
        ? theme?.getPropertyValue("--jank-warning").trim() || "#f26032"
        : theme?.getPropertyValue("--jl-muted").trim() || "#a3a3a3";
    const barHeight = Math.max(1, (durationMs / maximumMs) * (height - 5));
    context.fillRect(width - (frames.length - index) * 2, height - barHeight, 1, barHeight);
  });
  context.strokeStyle = theme?.getPropertyValue("--jl-control").trim() || "#3a3a3a";
  context.setLineDash([2, 3]);
  const budgetY = height - (chart.budgetMs / maximumMs) * (height - 5);
  context.beginPath();
  context.moveTo(0, budgetY);
  context.lineTo(width, budgetY);
  context.stroke();
  context.setLineDash([]);
  canvas.setAttribute(
    "aria-label",
    `${frames.length} recent frames; ${frames.filter((frame) => frame.endedAtMs - frame.startedAtMs > chart.limitMs).length} above budget; budget ${chart.budgetMs.toFixed(1)} milliseconds; chart maximum ${maximumMs.toFixed(1)} milliseconds`,
  );
}
