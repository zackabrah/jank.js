/** Structural subset of pinned Three r186 info; importing this adapter never imports Three. */
export interface ThreeCounterInfo {
  readonly render?: {
    readonly calls?: number;
    readonly drawCalls?: number;
    readonly triangles?: number;
    readonly points?: number;
    readonly lines?: number;
  };
  readonly memory?: { readonly geometries?: number; readonly textures?: number };
}

/** Read after the host's render, before its reset. Counts describe submissions, not GPU execution. */
export function readThreeRendererCounters(
  info: ThreeCounterInfo | null,
  backend: "webgl" | "webgpu",
) {
  const render = info?.render;
  return {
    drawCalls: count(backend === "webgpu" ? render?.drawCalls : render?.calls),
    triangles: count(render?.triangles),
    points: count(render?.points),
    lines: count(render?.lines),
    geometries: count(info?.memory?.geometries),
    textures: count(info?.memory?.textures),
  };
}
function count(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}
