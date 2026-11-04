import { WebGLRenderer } from "three";
import { WebGPURenderer } from "three/webgpu";
import { instrumentThreeDevice } from "../src/adapters/three-device.ts";
import {
  observeWebGlErrors,
  observeWebGpuErrors,
  type RendererIssue,
} from "../src/adapters/three-errors.ts";
import type { GpuFrame } from "../src/gpu/model.ts";
import { createWebGl2GpuSource } from "../src/gpu/webgl2.ts";

export type ThreeBackend = "webgl2" | "webgpu";

export async function createThreeRenderer(
  canvas: HTMLCanvasElement,
  backend: ThreeBackend,
  onFrame: (frame: GpuFrame) => void,
  onError: (issue: RendererIssue) => void,
) {
  if (backend === "webgl2") {
    const context = canvas.getContext("webgl2", { antialias: false });
    if (!context) throw new Error("WebGL2 is unavailable in this browser.");
    const renderer = new WebGLRenderer({ canvas, context, antialias: false });
    const probe = createWebGl2GpuSource(context, onFrame);
    const stopErrors = observeWebGlErrors(renderer, onError);
    return {
      renderer,
      injectError: undefined,
      supported: probe.supported,
      poll: probe.poll,
      beginFrame: (_id: number) => probe.poll(),
      beginPass: probe.beginPass,
      endPass: probe.endPass,
      endFrame: probe.captureFrame,
      setEnabled: probe.setEnabled,
      dispose() {
        stopErrors();
        probe.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  }
  if (!window.isSecureContext)
    throw new Error(
      "WebGPU needs HTTPS or localhost. For Jarvis, use an HTTPS tunnel or SSH port forwarding.",
    );
  if (!navigator.gpu)
    throw new Error("WebGPU is not available in this browser. WebGL2 is a separate option.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter)
    throw new Error("WebGPU found no available GPU adapter. No WebGL fallback was started.");
  const requiredFeatures: GPUFeatureName[] = [];
  if (adapter.features.has("timestamp-query")) requiredFeatures.push("timestamp-query");
  if (adapter.features.has("core-features-and-limits"))
    requiredFeatures.push("core-features-and-limits");
  const device = await adapter.requestDevice({ requiredFeatures });
  const probe = instrumentThreeDevice(device, onFrame);
  const renderer = new WebGPURenderer({
    canvas,
    device: probe.device,
    antialias: false,
    trackTimestamp: false,
  });
  try {
    await renderer.init();
    if (!("isWebGPUBackend" in renderer.backend) || renderer.backend.isWebGPUBackend !== true)
      throw new Error("A native WebGPU backend could not start; the fallback has been stopped.");
  } catch (error) {
    probe.dispose();
    try {
      await renderer.dispose();
    } finally {
      device.destroy();
    }
    throw error;
  }
  const stopErrors = observeWebGpuErrors(renderer, device, onError);
  return {
    renderer,
    injectError(kind: "shader" | "validation") {
      if (kind === "shader") {
        device.createShaderModule({ label: "Jank fault check", code: "JANK_INVALID_WGSL" });
      } else {
        device.pushErrorScope("validation");
        device.createBuffer({ label: "Jank fault check", size: 4, usage: 0 }).destroy();
        void device.popErrorScope().catch(() => {});
      }
    },
    supported: probe.supported,
    poll() {},
    beginFrame: probe.beginFrame,
    beginPass: probe.label,
    endPass() {},
    endFrame: (_id: number, _inventory: GpuFrame["inventory"]) => probe.endFrame(),
    setEnabled: probe.setEnabled,
    dispose() {
      stopErrors();
      probe.dispose();
      void renderer
        .dispose()
        .catch(() =>
          onError({
            label: "WebGPU cleanup error",
            detail: "WebGPU renderer cleanup failed.",
            asynchronous: true,
          }),
        )
        .finally(() => device.destroy());
    },
  };
}
