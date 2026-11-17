import { expect, test, vi } from "vitest";
import type { GpuFrame } from "./model.ts";
import { createWebGpuSource } from "./webgpu.ts";

function fixture() {
  const frames = new Map<number, GpuFrame>();
  const buffers: {
    values: BigUint64Array;
    complete: () => void;
    fail: () => void;
    mapAsync: () => Promise<void>;
    getMappedRange: () => ArrayBuffer;
    unmap: () => void;
    destroy: () => void;
  }[] = [];
  let lose: ((value: { message: string }) => void) | undefined;
  const device = {
    features: new Set(["timestamp-query"]),
    lost: new Promise<{ message: string }>((resolve) => {
      lose = resolve;
    }),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(() => {
      const values = new BigUint64Array(64);
      let complete = () => {},
        fail = () => {};
      const pending = new Promise<void>((resolve, reject) => {
        complete = resolve;
        fail = () => reject(new Error("readback failed"));
      });
      const buffer = {
        values,
        complete,
        fail,
        mapAsync: vi.fn(() => pending),
        getMappedRange: () => values.buffer,
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
  };
  const encoder = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() };
  const source = createWebGpuSource(device, (frame) => frames.set(frame.frameId, frame));
  const draw = (id: number) => {
    source.beginFrame(id, "complete");
    source.timestampWrites("Scene", "render");
    source.endFrame(encoder);
    source.readSubmittedFrames();
  };
  return {
    source,
    buffers,
    frames,
    encoder,
    device,
    draw,
    lose: () => lose?.({ message: "test loss" }),
  };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("joins render and compute timestamps to the original frame and subtracts bigint before conversion", async () => {
  const f = fixture();
  f.source.beginFrame(10, "complete");
  expect(f.source.timestampWrites("Scene", "render")?.beginningOfPassWriteIndex).toBe(0);
  expect(f.source.timestampWrites("Compute", "compute")?.beginningOfPassWriteIndex).toBe(2);
  f.source.endFrame(f.encoder);
  expect(f.buffers[1]?.mapAsync).not.toHaveBeenCalled();
  f.source.readSubmittedFrames();
  f.source.readSubmittedFrames();
  const read = f.buffers[1];
  if (!read) throw new Error("No readback buffer");
  expect(read.mapAsync).toHaveBeenCalledTimes(1);
  const origin = 2n ** 60n;
  read.values.set([origin, origin + 100000n, origin + 100000n, origin + 100000n]);
  read.complete();
  await settle();
  expect(f.frames.get(10)?.invocations.map((pass) => [pass.kind, pass.milliseconds])).toEqual([
    ["render", 0.1],
    ["compute", 0],
  ]);
  expect(read.unmap).toHaveBeenCalledOnce();
  f.source.dispose();
});

test("rejects counter resets, readback failures and stale results after disable", async () => {
  for (const values of [
    [20n, 10n],
    [0n, BigInt(Number.MAX_SAFE_INTEGER) + 1n],
  ]) {
    const f = fixture();
    f.draw(1);
    f.buffers[1]?.values.set(values);
    f.buffers[1]?.complete();
    await settle();
    expect(f.frames.get(1)?.invocations[0]?.reason).toContain("counter reset");
    f.source.dispose();
  }
  const failed = fixture();
  failed.draw(2);
  failed.buffers[1]?.fail();
  await settle();
  expect(failed.frames.get(2)?.invocations[0]?.reason).toBe("GPU readback failed");
  failed.source.dispose();
  const disabled = fixture();
  disabled.draw(3);
  disabled.source.setEnabled(false);
  disabled.buffers[1]?.values.set([0n, 200000n]);
  disabled.buffers[1]?.complete();
  await settle();
  expect(disabled.frames.get(3)?.invocations[0]).toMatchObject({
    state: "rejected",
    milliseconds: null,
  });
  disabled.source.dispose();
});

test("bounds the pool and explicitly accounts for omitted work and device loss", async () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.draw(i);
  expect(f.device.createQuerySet).toHaveBeenCalledTimes(8);
  expect(f.frames.get(8)?.invocations[0]).toMatchObject({
    state: "omitted",
    reason: "GPU readback pool full",
  });
  f.lose();
  await settle();
  expect(f.frames.get(0)?.invocations[0]?.reason).toContain("device lost");
  expect(f.buffers.every((buffer) => vi.mocked(buffer.destroy).mock.calls.length === 1)).toBe(true);
  for (const buffer of f.buffers) buffer.complete();
  await settle();
  expect(f.frames.get(0)?.invocations[0]?.state).toBe("rejected");
});

test("times nested passes that start before the first encoded pass", async () => {
  const f = fixture();
  f.source.beginFrame(10, "complete");
  f.source.timestampWrites("Output", "render");
  f.source.timestampWrites("Scene", "render");
  f.source.endFrame(f.encoder);
  f.source.readSubmittedFrames();
  const read = f.buffers[1];
  if (!read) throw new Error("No readback buffer");
  const origin = 2n ** 40n;
  read.values.set([origin + 2000000n, origin + 3000000n, origin, origin + 1000000n]);
  read.complete();
  await settle();
  expect(
    f.frames.get(10)?.invocations.map((pass) => [pass.state, pass.startMs, pass.endMs]),
  ).toEqual([
    ["timed", 2, 3],
    ["timed", 0, 1],
  ]);
  f.source.dispose();
});
