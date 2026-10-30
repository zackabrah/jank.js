import { describe, expect, it, vi } from "vitest";
import type { GpuState } from "../core/gpu.ts";
import { createThreeWebGpuSource, type ThreeTimestampRenderer } from "./three-webgpu.ts";

function rendererFixture() {
  const deviceLoss = Promise.withResolvers<unknown>();
  const reads: ReturnType<typeof Promise.withResolvers<number | undefined>>[] = [];
  let frames: unknown = [];
  const renderer = {
    initialized: true as boolean,
    info: { frame: 1 },
    backend: {
      isWebGPUBackend: true,
      trackTimestamp: true,
      getTimestampFrames: () => frames,
      device: { lost: deviceLoss.promise },
    },
    hasFeature: vi.fn(() => true),
    resolveTimestampsAsync: vi.fn(() => {
      const read = Promise.withResolvers<number | undefined>();
      reads.push(read);
      return read.promise;
    }),
    dispose: vi.fn(),
  } satisfies ThreeTimestampRenderer & { dispose(): void };
  const flush = async () => {
    for (let step = 0; step < 6; step += 1) {
      await Promise.resolve();
    }
  };
  return {
    renderer,
    resolve: async (frameIds: unknown, durationMs: number | undefined) => {
      frames = frameIds;
      reads.shift()?.resolve(durationMs);
      await flush();
    },
    reject: async (cause: unknown) => {
      reads.shift()?.reject(cause);
      await flush();
    },
    loseDevice: async () => {
      deviceLoss.resolve({ message: "Lost for test" });
      await flush();
    },
  };
}

describe("Three r186 WebGPU timing", () => {
  it("resolves one read at a time and correlates delayed pass sums without reusing cached samples", async () => {
    const fixture = rendererFixture();
    const samples: GpuState[] = [];
    const gpu = createThreeWebGpuSource(fixture.renderer, {
      revision: "186",
      onSample: (sample) => samples.push(sample),
    });
    gpu.captureFrame(101);
    fixture.renderer.info.frame = 2;
    gpu.captureFrame(102);
    expect(fixture.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    await fixture.resolve([1], 0);
    expect(samples[0]).toMatchObject({
      status: "ready",
      currentRendererFrameId: 2,
      sample: {
        frameId: 101,
        rendererFrameId: 1,
        measurement: "pass-sum",
        durationMs: 0,
        passes: [{ label: "Three.js render passes (sum)", durationMs: 0 }],
      },
    });
    gpu.captureFrame(102);
    await fixture.resolve([1], 0);
    expect(samples).toHaveLength(1);
    fixture.renderer.info.frame = 3;
    gpu.captureFrame(103);
    await fixture.resolve([2, 3], 2.5);
    expect(samples[1]).toMatchObject({
      droppedSamples: 1,
      sample: { frameId: 103, rendererFrameId: 3, durationMs: 2.5 },
    });
    const detached = gpu.read();
    if (detached.status === "ready") {
      Reflect.set(detached.sample.passes[0] ?? {}, "durationMs", 999);
    }
    expect(gpu.read()).toMatchObject({
      sample: { durationMs: 2.5, passes: [{ durationMs: 2.5 }] },
    });
    gpu.dispose();
  });

  it("ignores late reads across disable/re-enable and disposal, and restores only its own tracking setting", async () => {
    const fixture = rendererFixture();
    fixture.renderer.backend.trackTimestamp = false;
    const onSample = vi.fn();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186", onSample });
    expect(fixture.renderer.backend.trackTimestamp).toBe(true);
    gpu.captureFrame(1);
    gpu.setEnabled(false);
    gpu.setEnabled(false);
    gpu.setEnabled(true);
    fixture.renderer.info.frame = 2;
    gpu.captureFrame(2);
    expect(fixture.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    await fixture.resolve([1], 1);
    expect(onSample).not.toHaveBeenCalled();
    expect(gpu.read().status).toBe("pending");
    gpu.captureFrame(2);
    await fixture.resolve([1], 1);
    expect(onSample).not.toHaveBeenCalled();
    fixture.renderer.info.frame = 3;
    gpu.captureFrame(3);
    gpu.dispose();
    gpu.dispose();
    await fixture.resolve([3], 1);
    gpu.setEnabled(true);
    gpu.captureFrame(4);
    expect(onSample).not.toHaveBeenCalled();
    expect(gpu.read().status).toBe("disabled");
    expect(fixture.renderer.backend.trackTimestamp).toBe(false);
    expect(fixture.renderer.dispose).not.toHaveBeenCalled();
  });

  it("preserves a host tracking change on disposal and can start disabled", () => {
    const fixture = rendererFixture();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186", enabled: false });
    expect(gpu.read().status).toBe("disabled");
    expect(fixture.renderer.backend.trackTimestamp).toBe(false);
    gpu.captureFrame(1);
    expect(fixture.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    gpu.setEnabled(true);
    fixture.renderer.backend.trackTimestamp = false;
    gpu.dispose();
    expect(fixture.renderer.backend.trackTimestamp).toBe(false);
  });

  it("requires an initialized renderer and the verified revision", () => {
    const fixture = rendererFixture();
    expect(() => createThreeWebGpuSource(fixture.renderer, { revision: "185" })).toThrow("r186");
    fixture.renderer.initialized = false;
    expect(() => createThreeWebGpuSource(fixture.renderer, { revision: "186" })).toThrow("init");
  });

  it("reports missing features and unsupported backends without changing their tracking", () => {
    const fixture = rendererFixture();
    fixture.renderer.hasFeature.mockReturnValue(false);
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
    gpu.setEnabled(true);
    gpu.captureFrame(1);
    gpu.dispose();
    expect(gpu.read()).toMatchObject({ status: "unsupported" });
    expect(fixture.renderer.backend.trackTimestamp).toBe(true);
    const invalid = createThreeWebGpuSource(
      { ...fixture.renderer, backend: {} },
      { revision: "186" },
    );
    expect(invalid.read().status).toBe("unsupported");
    invalid.dispose();
  });

  it("rejects invalid and conflicting frame links without issuing a resolve", async () => {
    const fixture = rendererFixture();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
    expect(() => gpu.captureFrame(0)).toThrow(RangeError);
    fixture.renderer.info.frame = -1;
    expect(() => gpu.captureFrame(1)).toThrow(RangeError);
    fixture.renderer.info.frame = 1;
    gpu.captureFrame(101);
    expect(() => gpu.captureFrame(102)).toThrow("linked");
    await fixture.resolve([1], undefined);
    expect(gpu.read().status).toBe("pending");
    fixture.renderer.info.frame = 0;
    expect(() => gpu.captureFrame(103)).toThrow(RangeError);
    gpu.dispose();
  });

  it("does not invent a frame link after bounded history evicts an unresolved frame", async () => {
    const fixture = rendererFixture();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
    for (let frame = 1; frame <= 601; frame += 1) {
      fixture.renderer.info.frame = frame;
      gpu.captureFrame(frame + 100);
    }
    await fixture.resolve([1], 2);
    expect(gpu.read()).toMatchObject({
      status: "ready",
      droppedSamples: 1,
      sample: { frameId: null, rendererFrameId: 1 },
    });
    gpu.dispose();
  });

  it.each([null, [-1], [1.5], ["1"], [2]])(
    "rejects malformed or future timestamp frame data: %j",
    async (frames) => {
      const fixture = rendererFixture();
      const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
      gpu.captureFrame(1);
      await fixture.resolve(frames, 1);
      expect(gpu.read().status).toBe("error");
      gpu.dispose();
    },
  );

  it.each([NaN, -1, Infinity])("rejects invalid durations: %s", async (durationMs) => {
    const fixture = rendererFixture();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
    gpu.captureFrame(1);
    await fixture.resolve([1], durationMs);
    expect(gpu.read().status).toBe("error");
    gpu.dispose();
  });

  it("reports rejected reads and observer errors without unhandled rejections, then recovers", async () => {
    const fixture = rendererFixture();
    const onSample = vi.fn().mockImplementationOnce(() => {
      throw new Error("Observer failed");
    });
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186", onSample });
    gpu.captureFrame(1);
    await fixture.reject(new Error("Read failed"));
    expect(gpu.read()).toEqual({ status: "error", message: "Read failed" });
    fixture.renderer.info.frame = 2;
    gpu.captureFrame(2);
    await fixture.resolve([2], 1);
    expect(gpu.read()).toEqual({ status: "error", message: "Observer failed" });
    fixture.renderer.info.frame = 3;
    gpu.captureFrame(null);
    await fixture.resolve([3], 2);
    expect(gpu.read()).toMatchObject({ status: "ready", sample: { frameId: null, durationMs: 2 } });
    gpu.dispose();
  });

  it("invalidates pending results on device loss without touching host device callbacks", async () => {
    const fixture = rendererFixture();
    const onSample = vi.fn();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186", onSample });
    gpu.captureFrame(1);
    await fixture.loseDevice();
    await fixture.resolve([1], 1);
    expect(gpu.read()).toMatchObject({
      status: "error",
      message: expect.stringContaining("device lost"),
    });
    expect(onSample).not.toHaveBeenCalled();
    gpu.setEnabled(true);
    gpu.captureFrame(2);
    gpu.dispose();
    expect(fixture.renderer.dispose).not.toHaveBeenCalled();
  });

  it("does not revive a disposed adapter when the device is later lost", async () => {
    const fixture = rendererFixture();
    const gpu = createThreeWebGpuSource(fixture.renderer, { revision: "186" });
    gpu.dispose();
    await fixture.loseDevice();
    expect(gpu.read().status).toBe("disabled");
  });
});
