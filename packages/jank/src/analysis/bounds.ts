export interface DebugBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly culled: boolean;
}
export interface BoundsSnapshot {
  readonly bounds: readonly DebugBounds[];
  readonly omitted: number;
  /** Column-major, unjittered world-to-clip matrix for the target viewport. */
  readonly viewProjection: readonly number[];
  readonly clipDepth: "minus-one-to-one" | "zero-to-one";
}
type Point = readonly [number, number, number, number];
export type ScreenSegment = readonly [number, number, number, number];

/** Conservative AABB wireframe, clipped before perspective division. Coordinates are viewport fractions. */
export function projectBounds(
  box: DebugBounds,
  matrix: readonly number[],
  depth: BoundsSnapshot["clipDepth"],
): ScreenSegment[] {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite) || !validBox(box)) {
    return [];
  }
  const result: ScreenSegment[] = [];
  for (let corner = 0; corner < 8; corner += 1) {
    for (const bit of [1, 2, 4]) {
      if (corner & bit) {
        continue;
      }
      const edge = clipEdge(
        transformCorner(box, matrix, corner),
        transformCorner(box, matrix, corner | bit),
        depth,
      );
      if (edge) {
        result.push(edge);
      }
    }
  }
  return result;
}
function validBox(box: DebugBounds): boolean {
  return ([0, 1, 2] as const).every((axis) => {
    const min = box.min[axis];
    const max = box.max[axis];
    return Number.isFinite(min) && Number.isFinite(max) && min <= max;
  });
}
function distances([x, y, z, w]: Point, depth: BoundsSnapshot["clipDepth"]): number[] {
  return [w + x, w - x, w + y, w - y, depth === "zero-to-one" ? z : w + z, w - z, w - 1e-7];
}
function clipEdge(a: Point, b: Point, depth: BoundsSnapshot["clipDepth"]): ScreenSegment | null {
  const from = distances(a, depth);
  const to = distances(b, depth);
  let start = 0;
  let end = 1;
  for (let plane = 0; plane < from.length; plane += 1) {
    const x = from[plane] ?? 0;
    const y = to[plane] ?? 0;
    if (x < 0 && y < 0) {
      return null;
    }
    if (x < 0) {
      start = Math.max(start, x / (x - y));
    }
    if (y < 0) {
      end = Math.min(end, x / (x - y));
    }
  }
  if (start > end) {
    return null;
  }
  const first = screen(a, b, start);
  const last = screen(a, b, end);
  const line: ScreenSegment = [first[0], first[1], last[0], last[1]];
  return line.every(Number.isFinite) ? line : null;
}
function screen(a: Point, b: Point, fraction: number): readonly [number, number] {
  const w = a[3] + fraction * (b[3] - a[3]);
  const x = (a[0] + fraction * (b[0] - a[0])) / w;
  const y = (a[1] + fraction * (b[1] - a[1])) / w;
  return [Math.max(0, Math.min(1, (x + 1) / 2)), Math.max(0, Math.min(1, (1 - y) / 2))];
}

function transformCorner(box: DebugBounds, matrix: readonly number[], corner: number): Point {
  const x = corner & 1 ? box.max[0] : box.min[0];
  const y = corner & 2 ? box.max[1] : box.min[1];
  const z = corner & 4 ? box.max[2] : box.min[2];
  // Caller validated all sixteen finite matrix coefficients before projecting any corner.
  const [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = matrix as readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return [
    a * x + e * y + i * z + m,
    b * x + f * y + j * z + n,
    c * x + g * y + k * z + o,
    d * x + h * y + l * z + p,
  ];
}
