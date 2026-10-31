import { type BoundsSnapshot, projectBounds } from "../analysis/bounds.ts";

/** Owns only its canvas. Host calls render after camera/visibility updates; no extra frame loop. */
export function createBoundsOverlay(
  target: HTMLElement,
  options: { readonly maxBounds?: number } = {},
) {
  const maximum = options.maxBounds ?? 128;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 2048) {
    throw new RangeError("Bounds capacity must be 1–2048");
  }
  const canvas = target.ownerDocument.createElement("canvas");
  canvas.dataset.jankBounds = "";
  canvas.setAttribute("aria-label", "Debug bounds: white visible, orange culled");
  canvas.style.cssText = "position:fixed;pointer-events:none;z-index:10;display:none";
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Debug bounds require a 2D canvas");
  }
  target.ownerDocument.body.append(canvas);
  let disposed = false;
  return {
    render: (snapshot: BoundsSnapshot | null) => {
      if (disposed) {
        return;
      }
      canvas.style.display = snapshot ? "block" : "none";
      if (!snapshot) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const scale = Math.min(2, target.ownerDocument.defaultView?.devicePixelRatio ?? 1);
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      drawBounds(context, snapshot, { width: rect.width, height: rect.height, maximum });
    },
    dispose: () => {
      disposed = true;
      canvas.remove();
    },
  };
}

function drawBounds(
  context: CanvasRenderingContext2D,
  snapshot: BoundsSnapshot,
  size: { width: number; height: number; maximum: number },
): void {
  const count = Math.min(size.maximum, snapshot.bounds.length);
  context.canvas.dataset.omitted = String(
    Math.max(0, snapshot.omitted) + snapshot.bounds.length - count,
  );
  context.canvas.dataset.drawn = String(count);
  for (const box of snapshot.bounds.slice(0, count)) {
    context.strokeStyle = box.culled ? "#ff6428" : "#eeeeee";
    context.beginPath();
    for (const [x, y, endX, endY] of projectBounds(
      box,
      snapshot.viewProjection,
      snapshot.clipDepth,
    )) {
      context.moveTo(x * size.width, y * size.height);
      context.lineTo(endX * size.width, endY * size.height);
    }
    context.stroke();
  }
}
