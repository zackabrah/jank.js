import type { CullingDiagnostics } from "../types/culling-types.ts";

type CullingBound = CullingDiagnostics["bounds"][number];

const axes = 3;

const cornerCount = 2 ** axes;

/** Homogeneous clip-space corners: x, y, z, w. */
const components = axes + 1;

const yComponent = 1,
  zComponent = 2,
  wComponent = 3;

/** Column-major matrix column offsets; the translation column comes last. */
const yColumn = components,
  zColumn = yColumn + components,
  translationColumn = zColumn + components;

/** Corner index bits: x is bit 0, y bit 1, z bit 2. */
const xBit = 1,
  yBit = 2,
  zBit = 4;

/** Corner pairs that differ in one axis bit; the x edges, then y, then z. */
const boxEdges: number[] = [];

for (const bit of [xBit, yBit, zBit])
  for (let corner = 0; corner < cornerCount; corner++)
    if (!(corner & bit)) boxEdges.push(corner, corner | bit);

/** Screen segments: start x, start y, end x, end y. */
const segmentStride = 4;

const startY = 1,
  endX = 2,
  endY = 3;

/** Clip planes in order: left, right, bottom, top, near, far, then w > 0. */
const leftPlane = 0,
  rightPlane = 1,
  bottomPlane = 2,
  topPlane = 3,
  nearPlane = 4,
  farPlane = 5,
  clipPlaneCount = 7;

/** Keeps the divide by w finite. */
const minClipW = 1e-7;

const maxDrawnBounds = 128;

/** Reuses clip-space corners and screen segments; each project call replaces the output. */
export class CullingBoundsProjector {
  readonly segments = new Float64Array((boxEdges.length / 2) * segmentStride);
  private readonly corners = new Float64Array(cornerCount * components);

  /** Column-major world-to-clip matrix; WebGPU depth is 0 <= z <= w. */
  project(
    bound: CullingBound,
    matrix: readonly number[],
    width: number,
    height: number,
  ): number {
    if (
      matrix.length !== components * components ||
      !matrix.every(Number.isFinite) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return 0;

    for (let axis = 0; axis < axes; axis++) {
      if (
        !Number.isFinite(bound.min[axis]) ||
        !Number.isFinite(bound.max[axis]) ||
        bound.min[axis]! > bound.max[axis]!
      )
        return 0;
    }

    for (let i = 0; i < cornerCount; i++) {
      const x = i & xBit ? bound.max[0] : bound.min[0];

      const y = i & yBit ? bound.max[1] : bound.min[1];

      const z = i & zBit ? bound.max[2] : bound.min[2];

      const at = i * components;

      for (let row = 0; row < components; row++) {
        const value =
          matrix[row]! * x +
          matrix[yColumn + row]! * y +
          matrix[zColumn + row]! * z +
          matrix[translationColumn + row]!;

        if (!Number.isFinite(value)) return 0;

        this.corners[at + row] = value;
      }
    }

    let count = 0;

    for (let edge = 0; edge < boxEdges.length; edge += 2) {
      const a = boxEdges[edge]! * components,
        b = boxEdges[edge + 1]! * components;

      const ax = this.corners[a]!,
        ay = this.corners[a + yComponent]!;

      const az = this.corners[a + zComponent]!,
        aw = this.corners[a + wComponent]!;

      const bx = this.corners[b]!,
        by = this.corners[b + yComponent]!;

      const bz = this.corners[b + zComponent]!,
        bw = this.corners[b + wComponent]!;

      let start = 0,
        end = 1,
        rejected = false;

      // Clip each edge in homogeneous space before dividing by w. The positive-w
      // plane excludes the singular eye point even for unusual supplied matrices.
      for (let plane = 0; plane < clipPlaneCount; plane++) {
        let from: number, to: number;

        switch (plane) {
          case leftPlane:
            from = aw + ax;

            to = bw + bx;

            break;

          case rightPlane:
            from = aw - ax;

            to = bw - bx;

            break;

          case bottomPlane:
            from = aw + ay;

            to = bw + by;

            break;

          case topPlane:
            from = aw - ay;

            to = bw - by;

            break;

          case nearPlane:
            from = az;

            to = bz;

            break;

          case farPlane:
            from = aw - az;

            to = bw - bz;

            break;

          default:
            from = aw - minClipW;

            to = bw - minClipW;

            break;
        }

        if (from < 0 && to < 0) {
          rejected = true;

          break;
        }

        if (from >= 0 && to >= 0) continue;

        const crossing = from / (from - to);

        if (from < 0) start = Math.max(start, crossing);
        else end = Math.min(end, crossing);

        if (start > end) {
          rejected = true;

          break;
        }
      }

      if (rejected) continue;

      const startW = aw + (bw - aw) * start;

      const endW = aw + (bw - aw) * end;

      if (startW <= 0 || endW <= 0) continue;

      const x1 = (ax + (bx - ax) * start) / startW;

      const y1 = (ay + (by - ay) * start) / startW;

      const x2 = (ax + (bx - ax) * end) / endW;

      const y2 = (ay + (by - ay) * end) / endW;

      if (
        !Number.isFinite(x1) ||
        !Number.isFinite(y1) ||
        !Number.isFinite(x2) ||
        !Number.isFinite(y2)
      )
        continue;

      const at = count++ * segmentStride;

      this.segments[at] = ((Math.max(-1, Math.min(1, x1)) + 1) * width) / 2;
      this.segments[at + startY] =
        ((1 - Math.max(-1, Math.min(1, y1))) * height) / 2;
      this.segments[at + endX] =
        ((Math.max(-1, Math.min(1, x2)) + 1) * width) / 2;
      this.segments[at + endY] =
        ((1 - Math.max(-1, Math.min(1, y2))) * height) / 2;
    }

    return count;
  }
}

/** Host-refreshed main-view wire bounds; never schedules frames or owns a GPU resource. */
export function createCullingBoundsOverlay(viewport: HTMLElement) {
  const canvas = document.createElement("canvas");

  canvas.className = "jank-culling-bounds";
  canvas.setAttribute("aria-label", "Culling bounds overlay");

  const context = canvas.getContext("2d");

  const projector = new CullingBoundsProjector();

  let mounted = false,
    disposed = false;

  /** Wipes and detaches the overlay canvas; does nothing while it isn't mounted. */
  function clear() {
    if (!mounted) return;

    context?.clearRect(0, 0, canvas.width, canvas.height);

    canvas.remove();

    mounted = false;
  }

  return {
    refresh(profile: CullingDiagnostics | undefined) {
      if (disposed) return;

      if (!profile?.debugBounds || !profile.viewProjection || !context) {
        clear();

        return;
      }

      if (!mounted) {
        viewport.append(canvas);

        mounted = true;
      }

      const width = Math.max(1, viewport.clientWidth);

      const height = Math.max(1, viewport.clientHeight);

      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      const pixelWidth = Math.max(1, Math.round(width * ratio));

      const pixelHeight = Math.max(1, Math.round(height * ratio));

      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;

      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;

      let segmentCount = 0,
        renderedBounds = 0;

      const limit = Math.min(maxDrawnBounds, profile.bounds.length);

      for (let i = 0; i < limit; i++) {
        const bound = profile.bounds[i]!;

        const count = projector.project(
          bound,
          profile.viewProjection,
          width,
          height,
        );

        if (!count) continue;

        renderedBounds++;

        segmentCount += count;

        context.strokeStyle = bound.culled ? "#ff8174" : "#65e3ab";
        context.beginPath();

        for (let segment = 0; segment < count; segment++) {
          const at = segment * segmentStride;

          context.moveTo(
            projector.segments[at]!,
            projector.segments[at + startY]!,
          );
          context.lineTo(
            projector.segments[at + endX]!,
            projector.segments[at + endY]!,
          );
        }

        context.stroke();
      }

      canvas.dataset["renderedBounds"] = String(renderedBounds);
      canvas.dataset["segments"] = String(segmentCount);
    },
    dispose() {
      if (disposed) return;

      disposed = true;

      clear();
    },
  };
}
