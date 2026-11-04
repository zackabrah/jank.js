/// <reference types="@webgpu/types" />
import type { GpuFrame } from "../gpu/model.ts";
import { createWebGpuSource } from "../gpu/webgpu.ts";

/** A development-only device boundary: observe real passes without Three.js private hooks. */
export function instrumentThreeDevice(device: GPUDevice, onFrame: (frame: GpuFrame) => void) {
  const probe = createWebGpuSource(device, onFrame);
  const originalDescriptor = Object.getOwnPropertyDescriptor(device, "createCommandEncoder");
  const createEncoder = device.createCommandEncoder.bind(device);
  let active = false;
  let label = "Scene";
  let index = 0;
  function descriptor<T extends GPURenderPassDescriptor | GPUComputePassDescriptor>(
    value: T,
    kind: "render" | "compute",
  ) {
    if (!active) return value;
    if (value.timestampWrites)
      throw new Error("Three.js timestamp tracking must be disabled while Jank owns queries.");
    const timestampWrites = probe.timestampWrites(`${label} · ${kind} ${++index}`, kind);
    return timestampWrites ? { ...value, timestampWrites } : value;
  }
  const createCommandEncoder = (options?: GPUCommandEncoderDescriptor) => {
    const encoder = createEncoder(options);
    const beginRenderPass = (value: GPURenderPassDescriptor) =>
      encoder.beginRenderPass(descriptor(value, "render"));
    const beginComputePass = (value: GPUComputePassDescriptor = {}) =>
      encoder.beginComputePass(descriptor(value, "compute"));
    return new Proxy(encoder, {
      get(target, key) {
        if (key === "beginRenderPass") return beginRenderPass;
        if (key === "beginComputePass") return beginComputePass;
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  // GPUCanvasContext.configure requires the real device; only wrap this owned instance's factory.
  Object.defineProperty(device, "createCommandEncoder", {
    value: createCommandEncoder,
    configurable: true,
    writable: true,
  });
  return {
    device,
    supported: probe.supported,
    beginFrame(id: number) {
      probe.beginFrame(id, "complete");
      active = true;
      index = 0;
    },
    label(value: string) {
      label = value;
    },
    endFrame() {
      active = false;
      const resolve = createEncoder({ label: "Jank timestamp readback" });
      probe.endFrame(resolve);
      device.queue.submit([resolve.finish()]);
      probe.readSubmittedFrames();
    },
    setEnabled: probe.setEnabled,
    dispose() {
      active = false;
      probe.dispose();
      if (device.createCommandEncoder === createCommandEncoder) {
        if (originalDescriptor)
          Object.defineProperty(device, "createCommandEncoder", originalDescriptor);
        else Reflect.deleteProperty(device, "createCommandEncoder");
      }
    },
  };
}
