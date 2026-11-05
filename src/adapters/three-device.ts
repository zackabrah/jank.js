/// <reference types="@webgpu/types" />
import type { GpuFrame } from "../gpu/model.ts";
import { createWebGpuSource } from "../gpu/webgpu.ts";

/** Replaces one method on an owned instance; the returned cleanup keeps later replacements. */
function countCalls(target: object, method: string, onCall: (args: unknown[]) => void) {
  const original: unknown = Reflect.get(target, method);
  if (typeof original !== "function") return () => {};
  const previous = Object.getOwnPropertyDescriptor(target, method);
  const counted = (...args: unknown[]) => {
    onCall(args);
    return Reflect.apply(original, target, args);
  };
  Object.defineProperty(target, method, { value: counted, configurable: true, writable: true });
  return () => {
    if (Reflect.get(target, method) !== counted) return;
    if (previous) Object.defineProperty(target, method, previous);
    else Reflect.deleteProperty(target, method);
  };
}

const byteLength = (data: unknown) =>
  ArrayBuffer.isView(data) || data instanceof ArrayBuffer ? data.byteLength : 0;

/** A development-only device boundary: observe real passes without Three.js private hooks. */
export function instrumentThreeDevice(
  device: GPUDevice,
  onFrame: (frame: GpuFrame) => void,
  /** Names a pass from its encoder's label and the host's own state; null keeps numbering. */
  describePass?: (encoderLabel: string | undefined) => string | null,
) {
  const probe = createWebGpuSource(device, onFrame);
  const originalDescriptor = Object.getOwnPropertyDescriptor(device, "createCommandEncoder");
  const createEncoder = device.createCommandEncoder.bind(device);
  let active = false;
  let label = "Scene";
  let index = 0;
  const named = new Map<string, number>();
  // Created counts run for the session, so a step or trend shows when and whether they stop.
  const created = { pipelines: 0, shaderModules: 0, textures: 0, buffers: 0, bindGroups: 0 };
  const frameCalls = { submits: 0, bufferWrites: 0, bufferWriteBytes: 0, textureWrites: 0 };
  let lastFrameCalls = { ...frameCalls };
  const stopCounting = [
    countCalls(device, "createRenderPipeline", () => created.pipelines++),
    countCalls(device, "createRenderPipelineAsync", () => created.pipelines++),
    countCalls(device, "createComputePipeline", () => created.pipelines++),
    countCalls(device, "createComputePipelineAsync", () => created.pipelines++),
    countCalls(device, "createShaderModule", () => created.shaderModules++),
    countCalls(device, "createTexture", () => created.textures++),
    countCalls(device, "createBuffer", () => created.buffers++),
    countCalls(device, "createBindGroup", () => created.bindGroups++),
    countCalls(device.queue, "submit", () => frameCalls.submits++),
    countCalls(device.queue, "writeTexture", () => frameCalls.textureWrites++),
    countCalls(device.queue, "writeBuffer", (args) => {
      frameCalls.bufferWrites++;
      frameCalls.bufferWriteBytes += byteLength(args[2]);
    }),
  ];
  function passLabel(kind: "render" | "compute", encoderLabel: string | undefined) {
    const name = describePass?.(encoderLabel);
    if (!name) return `${label} · ${kind} ${++index}`;
    // Name and occurrence stay stable when another pass appears or goes away.
    const occurrence = (named.get(name) ?? 0) + 1;
    named.set(name, occurrence);
    return occurrence > 1 ? `${name} ${occurrence}` : name;
  }
  function descriptor<T extends GPURenderPassDescriptor | GPUComputePassDescriptor>(
    value: T,
    kind: "render" | "compute",
    encoderLabel: string | undefined,
  ) {
    if (!active) return value;
    if (value.timestampWrites)
      throw new Error("Three.js timestamp tracking must be disabled while Jank owns queries.");
    const timestampWrites = probe.timestampWrites(passLabel(kind, encoderLabel), kind);
    return timestampWrites ? { ...value, timestampWrites } : value;
  }
  const createCommandEncoder = (options?: GPUCommandEncoderDescriptor) => {
    const encoder = createEncoder(options);
    const beginRenderPass = (value: GPURenderPassDescriptor) =>
      encoder.beginRenderPass(descriptor(value, "render", options?.label));
    const beginComputePass = (value: GPUComputePassDescriptor = {}) =>
      encoder.beginComputePass(descriptor(value, "compute", options?.label));
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
      named.clear();
      Object.assign(frameCalls, { submits: 0, bufferWrites: 0, bufferWriteBytes: 0 });
      frameCalls.textureWrites = 0;
    },
    label(value: string) {
      label = value;
    },
    /** Session totals, and the last finished frame's calls, for the host's counters. */
    gpuCalls() {
      return {
        pipelinesCreated: created.pipelines,
        shaderModulesCreated: created.shaderModules,
        texturesCreated: created.textures,
        buffersCreated: created.buffers,
        bindGroupsCreated: created.bindGroups,
        submitsPerFrame: lastFrameCalls.submits,
        bufferWritesPerFrame: lastFrameCalls.bufferWrites,
        bufferWriteBytesPerFrame: lastFrameCalls.bufferWriteBytes,
        textureWritesPerFrame: lastFrameCalls.textureWrites,
      };
    },
    endFrame() {
      active = false;
      lastFrameCalls = { ...frameCalls };
      const resolve = createEncoder({ label: "Jank timestamp readback" });
      probe.endFrame(resolve);
      device.queue.submit([resolve.finish()]);
      probe.readSubmittedFrames();
    },
    setEnabled: probe.setEnabled,
    dispose() {
      active = false;
      probe.dispose();
      for (const stop of stopCounting) stop();
      if (device.createCommandEncoder === createCommandEncoder) {
        if (originalDescriptor)
          Object.defineProperty(device, "createCommandEncoder", originalDescriptor);
        else Reflect.deleteProperty(device, "createCommandEncoder");
      }
    },
  };
}
