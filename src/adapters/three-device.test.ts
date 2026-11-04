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
