import type { Diagnostics } from "../core/diagnostics.ts";

/** Structural subset of Three.js renderer.info; no Three.js runtime dependency. */
export interface ThreeRendererInfo {
  render: { calls: number; triangles: number; points: number; lines: number };
  memory: { geometries: number; textures: number };
}

/** Time render submission with begin/end. Counters are host-owned; this never resets them. */
export function registerThreeRenderer(
  monitor: Diagnostics,
  info: ThreeRendererInfo,
) {
  return monitor.register("renderer", "Three.js render submission", () => ({
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
  }));
}
