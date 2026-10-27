import type { CullingDiagnostics } from "../types/culling-types.ts";

type CullingBound = CullingDiagnostics["bounds"][number];

const boxEdges = [
  0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7,
] as const;

/** Reuses clip-space corners and screen segments; each project call replaces the output. */
export class CullingBoundsProjector {
  readonly segments = new Float64Array(48);
  private readonly corners = new Float64Array(32);

  /** Column-major world-to-clip matrix; WebGPU depth is 0 <= z <= w. */
  project(
    bound: CullingBound,
    matrix: readonly number[],
    width: number,
    height: number,
  ): number {
    if (
      matrix.length !== 16 ||
      !matrix.every(Number.isFinite) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return 0;

    for (let axis = 0; axis < 3; axis++) {
      if (
        !Number.isFinite(bound.min[axis]) ||
        !Number.isFinite(bound.max[axis]) ||
        bound.min[axis]! > bound.max[axis]!
      )
        return 0;
    }

    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? bound.max[0] : bound.min[0];

      const y = i & 2 ? bound.max[1] : bound.min[1];

      const z = i & 4 ? bound.max[2] : bound.min[2];

      const at = i * 4;

      for (let row = 0; row < 4; row++) {
        const value =
          matrix[row]! * x +
          matrix[4 + row]! * y +
          matrix[8 + row]! * z +
          matrix[12 + row]!;

        if (!Number.isFinite(value)) return 0;

        this.corners[at + row] = value;
      }
    }

    let count = 0;

    for (let edge = 0; edge < boxEdges.length; edge += 2) {
      const a = boxEdges[edge]! * 4,
        b = boxEdges[edge + 1]! * 4;

      const ax = this.corners[a]!,
        ay = this.corners[a + 1]!;

      const az = this.corners[a + 2]!,
        aw = this.corners[a + 3]!;

      const bx = this.corners[b]!,
        by = this.corners[b + 1]!;

      const bz = this.corners[b + 2]!,
        bw = this.corners[b + 3]!;

      let start = 0,
        end = 1,
        rejected = false;

      // Clip each edge in homogeneous space before dividing by w. The positive-w
      // plane excludes the singular eye point even for unusual supplied matrices.
      for (let plane = 0; plane < 7; plane++) {
        let from: number, to: number;

        switch (plane) {
          case 0:
            from = aw + ax;

            to = bw + bx;

            break;

          case 1:
            from = aw - ax;

            to = bw - bx;

            break;

          case 2:
            from = aw + ay;

            to = bw + by;

            break;

          case 3:
            from = aw - ay;

            to = bw - by;

            break;

          case 4:
            from = az;

            to = bz;

            break;

          case 5:
            from = aw - az;

            to = bw - bz;

            break;

          default:
            from = aw - 1e-7;

            to = bw - 1e-7;

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

      const at = count++ * 4;

      this.segments[at] = (Math.max(-1, Math.min(1, x1)) + 1) * width * 0.5;

      this.segments[at + 1] =
        (1 - Math.max(-1, Math.min(1, y1))) * height * 0.5;

      this.segments[at + 2] = (Math.max(-1, Math.min(1, x2)) + 1) * width * 0.5;

      this.segments[at + 3] =
        (1 - Math.max(-1, Math.min(1, y2))) * height * 0.5;
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

      const limit = Math.min(128, profile.bounds.length);

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
          const at = segment * 4;

          context.moveTo(projector.segments[at]!, projector.segments[at + 1]!);

          context.lineTo(
            projector.segments[at + 2]!,
            projector.segments[at + 3]!,
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
