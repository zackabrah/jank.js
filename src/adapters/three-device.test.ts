import { expect, test, vi } from "vitest";
import type { GpuFrame } from "../gpu/model.ts";
import { instrumentThreeDevice } from "./three-device.ts";

function harness(supported = true) {
  const order: string[] = [];
  const frames = new Map<number, GpuFrame>();
  const descriptors: (GPURenderPassDescriptor | GPUComputePassDescriptor)[] = [];
  const raw = {
    features: new Set(supported ? ["timestamp-query"] : []),
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    queue: {
      submit: () => {
        order.push("submit");
      },
    },
    createQuerySet: vi.fn(() => ({ destroy() {} })),
    createBuffer: () => ({
      mapAsync: async () => {
        order.push("map");
      },
      getMappedRange: () => new BigUint64Array([1000000n, 2000000n, 2000000n, 4000000n]).buffer,
      unmap() {},
      destroy() {},
    }),
    createCommandEncoder() {
      expect(this).toBe(raw);
      const encoder = {
        beginRenderPass(value: GPURenderPassDescriptor) {
          expect(this).toBe(encoder);
          descriptors.push(value);
          return { end() {} };
        },
        beginComputePass(value: GPUComputePassDescriptor) {
          expect(this).toBe(encoder);
          descriptors.push(value);
          return { end() {} };
        },
        resolveQuerySet() {
          expect(this).toBe(encoder);
          order.push("resolve");
        },
        copyBufferToBuffer() {},
        finish() {
          expect(this).toBe(encoder);
          return {};
        },
      };
      return encoder;
    },
  };
  const original = raw.createCommandEncoder;
  const probe = instrumentThreeDevice(raw as unknown as GPUDevice, (frame) =>
    frames.set(frame.frameId, frame),
  );
  return { probe, raw, original, order, frames, descriptors };
}

test("adds queries to real render/compute descriptors, retains IDs and reads only after submission", async () => {
  const { probe, raw, original, order, frames, descriptors } = harness();
  expect(probe.device).toBe(raw);
  probe.beginFrame(7);
  probe.label("Scene 1");
  const encoder = probe.device.createCommandEncoder();
  const descriptor: GPURenderPassDescriptor = { colorAttachments: [] };
  encoder.beginRenderPass(descriptor).end();
  encoder.beginComputePass().end();
  expect(descriptor.timestampWrites).toBeUndefined();
  expect(descriptors.map((item) => item.timestampWrites?.beginningOfPassWriteIndex)).toEqual([
    0, 2,
  ]);
  probe.device.queue.submit([encoder.finish()]);
  probe.endFrame();
  expect(order).toEqual(["submit", "resolve", "submit", "map"]);
  probe.beginFrame(8);
  await vi.waitFor(() => expect(frames.get(7)?.invocations[0]?.state).toBe("timed"));
  expect(frames.get(7)?.invocations.map((item) => [item.kind, item.milliseconds])).toEqual([
    ["render", 1],
    ["compute", 2],
  ]);
  probe.endFrame();
  expect(frames.get(8)).toMatchObject({ frameId: 8, inventory: "complete", invocations: [] });
  probe.dispose();
  expect(raw.createCommandEncoder).toBe(original);
});

test("leaves setup passes untouched and marks unsupported timing without inventing zero", () => {
  const { probe, raw, frames, descriptors } = harness(false);
  const encoder = probe.device.createCommandEncoder();
  const descriptor: GPURenderPassDescriptor = { colorAttachments: [] };
  encoder.beginRenderPass(descriptor).end();
  expect(descriptors[0]).toBe(descriptor);
  probe.beginFrame(1);
  encoder.beginRenderPass(descriptor).end();
  probe.device.queue.submit([encoder.finish()]);
  probe.endFrame();
  expect(raw.createQuerySet).not.toHaveBeenCalled();
  expect(frames.get(1)?.invocations[0]).toMatchObject({
    state: "omitted",
    milliseconds: null,
    reason: "GPU timestamp queries unsupported",
  });
  probe.dispose();
});

test("refuses competing timestamp owners instead of overwriting their queries", () => {
  const { probe } = harness();
  probe.beginFrame(1);
  const encoder = probe.device.createCommandEncoder();
  expect(() =>
    encoder.beginRenderPass({
      colorAttachments: [],
      timestampWrites: { querySet: {} as GPUQuerySet, beginningOfPassWriteIndex: 0 },
    }),
  ).toThrow("timestamp tracking must be disabled");
  probe.dispose();
});

function miniDevice() {
  const encoder = {
    beginRenderPass: () => ({ end() {} }),
    resolveQuerySet() {},
    copyBufferToBuffer() {},
    finish: () => ({}),
  };
  const buffer = () => ({
    mapAsync: async () => {},
    getMappedRange: () => new BigUint64Array(64).buffer,
    unmap() {},
    destroy() {},
  });
  const device = {
    features: new Set(["timestamp-query"]),
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
    queue: { submit() {}, writeBuffer() {}, writeTexture() {} },
    createQuerySet: () => ({ destroy() {} }),
    createBuffer: buffer,
    createTexture: () => ({}),
    createBindGroup: () => ({}),
    createRenderPipeline: () => ({}),
    createShaderModule: () => ({}),
    createCommandEncoder: () => encoder,
  };
  return { raw: device, device: device as unknown as GPUDevice };
}

test("names passes from the host, numbering repeats rather than positions", () => {
  const { device } = miniDevice();
  const frames: GpuFrame[] = [];
  const names = ["Main", "Mips", "Mips"];
  const probe = instrumentThreeDevice(
    device,
    (frame) => frames.push(frame),
    () => names.shift() ?? null,
  );
  probe.beginFrame(1);
  const encoder = device.createCommandEncoder({ label: "any" });
  for (let i = 0; i < 4; i++) encoder.beginRenderPass({ colorAttachments: [] });
  probe.endFrame();
  expect(frames.at(-1)?.invocations.map((pass) => pass.label)).toEqual([
    "Main",
    "Mips",
    "Mips 2",
    "Scene · render 1",
  ]);
  probe.dispose();
});

test("passes the encoder's label to the host so it can recognize a mip chain", () => {
  const { device } = miniDevice();
  const seen: (string | undefined)[] = [];
  const probe = instrumentThreeDevice(
    device,
    () => {},
    (label) => {
      seen.push(label);
      return "Pass";
    },
  );
  probe.beginFrame(1);
  device.createCommandEncoder({ label: "mipmapEncoder" }).beginRenderPass({ colorAttachments: [] });
  device.createCommandEncoder().beginRenderPass({ colorAttachments: [] });
  expect(seen).toEqual(["mipmapEncoder", undefined]);
  probe.endFrame();
  probe.dispose();
});

test("counts GPU calls per frame and created resources per session, and restores on dispose", () => {
  const { raw, device } = miniDevice();
  const writeBuffer = raw.queue.writeBuffer;
  const createTexture = raw.createTexture;
  const probe = instrumentThreeDevice(device, () => {});
  const write = (bytes: number) =>
    device.queue.writeBuffer({} as GPUBuffer, 0, new Uint8Array(bytes));
  device.createTexture({} as GPUTextureDescriptor);
  device.createBindGroup({} as GPUBindGroupDescriptor);
  probe.beginFrame(1);
  write(100);
  write(28);
  device.queue.submit([]);
  device.createRenderPipeline({} as GPURenderPipelineDescriptor);
  probe.endFrame();
  expect(probe.gpuCalls()).toMatchObject({
    texturesCreated: 1,
    bindGroupsCreated: 1,
    pipelinesCreated: 1,
    bufferWritesPerFrame: 2,
    bufferWriteBytesPerFrame: 128,
    submitsPerFrame: 1,
  });
  probe.beginFrame(2);
  write(4);
  probe.endFrame();
  expect(probe.gpuCalls()).toMatchObject({
    texturesCreated: 1,
    bufferWritesPerFrame: 1,
    bufferWriteBytesPerFrame: 4,
    submitsPerFrame: 0,
  });
  probe.dispose();
  expect(raw.queue.writeBuffer).toBe(writeBuffer);
  expect(raw.createTexture).toBe(createTexture);
});
