/** Public GPU evidence API (`jank.js/gpu`), for `createPerformancePanel`'s `gpu` and `capture`. */
export { createGpuHistory } from "./gpu/history.ts";
export type { GpuFrame, GpuInvocation } from "./gpu/model.ts";
export { gpuFrameToLive } from "./gpu/model.ts";
export { createWebGl2GpuSource } from "./gpu/webgl2.ts";
export { createWebGpuSource } from "./gpu/webgpu.ts";
