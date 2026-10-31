import type { EventSample, FrameSample } from "../core/frames.ts";
import { frameLayout, framePitchPx } from "./frame-layout.ts";

interface LiveChartData {
  readonly frames: readonly FrameSample[];
  readonly events: readonly EventSample[];
  readonly budgetMs: number;
  readonly limitMs: number;
}
function palette(canvas: HTMLCanvasElement) {
  const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
  const token = (name: string, fallback: string) =>
    style?.getPropertyValue(name).trim() || fallback;
  return {
    bar: token("--jl-control", "#3a3a3a"),
    bright: token("--jl-bright", "#fff"),
    warning: token("--jank-warning", "#f26032"),
    guide: token("--jl-line", "#1f1f1f"),
    muted: token("--jl-muted", "#a3a3a3"),
    font: token("--jl-font", "monospace"),
  };
}

/** One chart owns its compositor animation and resize listener; never owns a frame loop. */
export function createLiveChart(container: HTMLElement, labels: boolean) {
  const found = container.querySelector("canvas");
  if (!found) {
    throw new Error("Missing live chart canvas");
  }
  const canvas = found;
  const document = container.ownerDocument;
  const window = document.defaultView;
  const motion = window?.matchMedia("(prefers-reduced-motion: reduce)");
  const theme = palette(canvas);
  const annotation = (name: string) => {
    const span = document.createElement("span");
    span.dataset.chartLabel = name;
    span.hidden = !labels;
    span.setAttribute("aria-hidden", "true");
    container.append(span);
    return span;
  };
  const worst = annotation("worst");
  const budget = annotation("budget");
  const event = annotation("event");
  let latest: LiveChartData | null = null;
  let newestId: number | null = null;
  let animation: Animation | null = null;
  let distancePx = 0;
  let durationMs = 100;
  let drawnAtMs = 0;
  let disposed = false;
  let widthPx = 0;

  function stop(): void {
    animation?.cancel();
    animation = null;
    newestId = null;
  }
  function glide(id: number | null, enabled: boolean): void {
    const previous = newestId;
    const nowMs = window?.performance.now() ?? 0;
    const elapsed = animation?.currentTime;
    const carry =
      typeof elapsed === "number" ? distancePx * Math.max(0, 1 - elapsed / durationMs) : 0;
    animation?.cancel();
    animation = null;
    newestId = id;
    const gapMs = nowMs - drawnAtMs;
    drawnAtMs = nowMs;
    if (
      !enabled ||
      motion?.matches ||
      document.hidden ||
      id === null ||
      previous === null ||
      id <= previous
    ) {
      return;
    }
    distancePx = Math.min(120, (id - previous) * framePitchPx + carry);
    durationMs = Math.max(100, Math.min(500, gapMs));
    animation = canvas.animate(
      [{ transform: `translateX(${distancePx}px)` }, { transform: "none" }],
      { duration: durationMs, easing: "linear" },
    );
    animation.startTime = document.timeline.currentTime;
  }
  function render(data: LiveChartData, animate: boolean): void {
    if (disposed) {
      return;
    }
    latest = data;
    widthPx = container.clientWidth;
    const height = container.clientHeight;
    if (!widthPx || !height) {
      stop();
      return;
    }
    const layout = frameLayout({ ...data, width: widthPx, height, labels });
    paint(canvas, { layout, theme, height, width: widthPx, limitMs: data.limitMs, labels });
    annotate(data, layout);
    glide(data.frames.at(-1)?.id ?? null, animate);
  }
  function annotate(data: LiveChartData, layout: ReturnType<typeof frameLayout>): void {
    worst.textContent = layout.worst
      ? `worst ${(layout.worst.endedAtMs - layout.worst.startedAtMs).toFixed(1)}`
      : "";
    worst.dataset.warning = String(
      !!layout.worst && layout.worst.endedAtMs - layout.worst.startedAtMs > data.limitMs,
    );
    budget.textContent = data.budgetMs.toFixed(1);
    budget.style.top = `${Math.max(24, layout.budgetY - 15)}px`;
    const mark = layout.latestEvent;
    const endedAtMs = data.frames.at(-1)?.endedAtMs ?? 0;
    event.textContent = mark
      ? `${mark.glyph} ${mark.name} · ${Math.max(0, (endedAtMs - mark.atMs) / 1000).toFixed(1)} s ago`
      : "";
    event.title = mark?.label ?? "";
    canvas.setAttribute(
      "aria-label",
      `${layout.visible.length} recent frames; budget ${data.budgetMs.toFixed(1)} milliseconds; ${worst.textContent || "no frames"}${mark ? `; ${event.textContent}` : ""}`,
    );
  }
  const resize = new ResizeObserver(() => {
    if (container.clientWidth !== widthPx && latest) {
      stop();
      render(latest, false);
    }
  });
  resize.observe(container);
  const visibility = () => {
    if (document.hidden) {
      stop();
    }
  };
  motion?.addEventListener("change", stop);
  document.addEventListener("visibilitychange", visibility);
  return {
    render,
    stop,
    dispose(): void {
      disposed = true;
      stop();
      resize.disconnect();
      motion?.removeEventListener("change", stop);
      document.removeEventListener("visibilitychange", visibility);
      worst.remove();
      budget.remove();
      event.remove();
    },
  };
}

interface PaintOptions {
  readonly layout: ReturnType<typeof frameLayout>;
  readonly theme: ReturnType<typeof palette>;
  readonly height: number;
  readonly width: number;
  readonly limitMs: number;
  readonly labels: boolean;
}
function paint(canvas: HTMLCanvasElement, options: PaintOptions): void {
  const { layout, theme, height, width, limitMs, labels } = options;
  const ratio = Math.min(3, canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
  const fullWidth = width + layout.margin;
  if (
    canvas.width !== Math.round(fullWidth * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(fullWidth * ratio);
    canvas.height = Math.round(height * ratio);
  }
  canvas.style.width = `${fullWidth}px`;
  canvas.style.left = `-${layout.margin}px`;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, fullWidth, height);
  if (labels) {
    drawGuides(context, fullWidth, layout.barBottom, theme.guide);
  }
  for (const bar of layout.bars) {
    context.fillStyle = bar.frame.id === layout.bars.at(-1)?.frame.id ? theme.bright : theme.bar;
    if (bar.frame.endedAtMs - bar.frame.startedAtMs > limitMs) {
      context.fillStyle = theme.warning;
    }
    context.fillRect(bar.x, layout.barBottom - bar.height, 2, bar.height);
  }
  context.strokeStyle = theme.muted;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(0, layout.budgetY);
  context.lineTo(fullWidth, layout.budgetY);
  context.stroke();
  context.setLineDash([]);
  if (labels) {
    drawMarkers(context, options);
  }
}
function drawGuides(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
): void {
  context.fillStyle = color;
  for (let y = 10; y < height; y += 20) {
    for (let x = 0; x < width; x += 10) {
      context.fillRect(x, y, 1, 1);
    }
  }
}
function drawMarkers(
  context: CanvasRenderingContext2D,
  { layout, theme, limitMs, width }: PaintOptions,
): void {
  context.font = `10px ${theme.font}`;
  const worst = layout.bars.find((bar) => bar.frame.id === layout.worst?.id);
  if (worst) {
    context.fillStyle =
      worst.frame.endedAtMs - worst.frame.startedAtMs > limitMs ? theme.warning : theme.muted;
    const markerX = Math.max(
      0,
      Math.min(width + layout.margin - context.measureText("▾").width, worst.x - 2),
    );
    context.fillText("▾", markerX, 23);
  }
  context.fillStyle = theme.muted;
  for (const event of layout.events) {
    context.fillText(event.glyph, event.x, layout.barBottom + 12);
  }
}
