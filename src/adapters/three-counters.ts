import type { WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { DiagnosticValues } from "../recording/types.ts";

const buffers = [
  "attributes",
  "indexAttributes",
  "storageAttributes",
  "indirectStorageAttributes",
  "uniformBuffers",
  "readbackBuffers",
] as const;

const available = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;

/** Read after all frame work; resetting renderer.info remains the host's responsibility. */
export function readThreeCounters(info: WebGLRenderer["info"] | WebGPURenderer["info"]) {
  const gpu = "compute" in info ? info : null;
  const gl = "programs" in info ? info : null;
  const values: Record<string, DiagnosticValues[string]> = {
    backend: gpu ? "webgpu" : "webgl2",
    drawCalls: available(gpu ? gpu.render.drawCalls : info.render.calls),
    triangles: available(info.render.triangles),
    lines: available(info.render.lines),
    points: available(info.render.points),
    renderCalls: available(gpu?.render.frameCalls),
    computeCalls: available(gpu?.compute.frameCalls),
    geometries: available(info.memory.geometries),
    textures: available(info.memory.textures),
    programs: gl?.programs?.length ?? null,
    // WebGPU counts programmable stages, unlike WebGL's linked programs.
    shaderStages: available(gpu?.memory.programs),
    renderTargets: available(gpu?.memory.renderTargets),
    trackedStorageEstimateBytes: available(gpu?.memory.total),
    textureStorageEstimateBytes: available(gpu?.memory.texturesSize),
    shaderSourceEstimateBytes: available(gpu?.memory.programsSize),
  };
  for (const name of buffers) {
    values[name] = available(gpu?.memory[name]);
    values[`${name}EstimateBytes`] = available(gpu?.memory[`${name}Size`]);
  }
  return values;
}
