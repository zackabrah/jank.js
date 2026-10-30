import { describe, expect, it, vi } from "vitest";
import { webGpuDeviceFixture } from "../../../../tests/fixtures/webgpu-device.ts";
import type { GpuState } from "../core/gpu.ts";
import { createThreeWebGpuSource } from "./three-webgpu.ts";

function fixture() {
  const gpu = webGpuDeviceFixture();
  const backend = {
    isWebGPUBackend: true,
    trackTimestamp: true,
    device: gpu.device,
    timestampQueryPool: { render: null, compute: null },
    initTimestampQuery: vi.fn(
      (
        _type: string,
        _uid: string,
        _descriptor: { timestampWrites?: GPURenderPassTimestampWrites },
      ) => {},
    ),
    resolveTimestampsAsync: vi.fn(async () => 123),
  };
  const renderer = {
    initialized: true as boolean,
    info: { frame: 0 },
    backend,
    hasFeature: vi.fn(() => true),
    resolveTimestampsAsync: async () => backend.resolveTimestampsAsync(),
  };
  return {
    ...gpu,
    backend,
    renderer,
    pass: (type: "render" | "compute", uid: string, interval: [bigint, bigint] = [100n, 110n]) => {
      const descriptor: GPURenderPassDescriptor = { colorAttachments: [] };
      backend.initTimestampQuery(type, uid, descriptor);
      const encoder = gpu.device.createCommandEncoder();
      if (type === "render") {
        encoder.beginRenderPass(descriptor);
      } else {
        encoder.beginComputePass(descriptor);
      }
      const native = gpu.descriptors.at(-1) ?? {};
      if (native.timestampWrites) {
        gpu.write(native.timestampWrites, ...interval);
      }
      return native;
    },
  };
}

describe("Three WebGPU application-frame intervals", () => {
  it("rejects async submission without leaking its rejection into the host loop", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    source.beginFrame(1);
    expect(() =>
      // biome-ignore lint/nursery/noMisusedPromises: Deliberately violate the synchronous host contract to test rejection handling.
      source.withPass({ id: "async", label: "Async" }, async () => {
        throw new Error("Rejected async submit");
      }),
    ).toThrow("synchronous");
    source.endFrame();
    await host.flush();
    expect(source.read()).toMatchObject({
      sample: { metrics: null, issues: ["submission-error"] },
    });
    source.dispose();
  });
  it("does not let an older completion replace a newer frame after a timing error", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    for (const frame of [1, 2, 3]) {
      source.beginFrame(frame);
      host.pass("compute", `c:a:f${frame}`);
      source.endFrame();
    }
    await host.resolve(2);
    await host.reject(new Error("Older read failed"), 1);
    await host.resolve(0);
    expect(source.read()).toMatchObject({ status: "error", message: "Older read failed" });
    source.dispose();
  });
  it("bounds finalization waits, rejects concurrent/open-frame drains, and survives cancellation", async () => {
    vi.useFakeTimers();
    try {
      const host = fixture();
      const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
      source.beginFrame(1);
      await expect(source.resolveFrames([1], { timeoutMs: 10 })).rejects.toThrow("endFrame");
      host.pass("compute", "c:a:f1");
      source.endFrame();
      const waiting = source.resolveFrames([1], { timeoutMs: 50 });
      await expect(source.resolveFrames([1], { timeoutMs: 50 })).rejects.toThrow("already pending");
      await vi.advanceTimersByTimeAsync(50);
      expect(await waiting).toMatchObject({ status: "timeout", samples: [], pendingFrameIds: [1] });
      const finishing = source.resolveFrames([1], { timeoutMs: 50 });
      await host.resolve();
      expect(await finishing).toMatchObject({
        status: "settled",
        samples: [{ frameId: 1, completeness: "complete" }],
        pendingFrameIds: [],
      });
      await expect(
        source.resolveFrames(
          Array.from({ length: 6001 }, () => 1),
          { timeoutMs: 0 },
        ),
      ).rejects.toThrow("6000");
      await expect(source.resolveFrames([0], { timeoutMs: 0 })).rejects.toThrow(RangeError);
      await expect(source.resolveFrames([1], { timeoutMs: -1 })).rejects.toThrow(RangeError);
      source.beginFrame(2);
      host.pass("render", "r:b:f2");
      source.endFrame();
      const cancelled = source.resolveFrames([2], { timeoutMs: 50 });
      source.dispose();
      expect((await cancelled).status).toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes an earlier compute start and rejects gaps beyond the representable frame span", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    source.beginFrame(1);
    host.pass("render", "r:a:f1", [1000n, 1200n]);
    host.pass("compute", "c:b:f1", [100n, 400n]);
    source.endFrame();
    await host.resolve();
    expect(source.read()).toMatchObject({
      sample: { clock: { originNs: "100" }, metrics: { busyMs: 0.0005, elapsedSpanMs: 0.0011 } },
    });
    source.beginFrame(2);
    host.pass("render", "r:a:f2", [100n, 200n]);
    host.pass("compute", "c:b:f2", [70_000_000_100n, 70_000_000_200n]);
    source.endFrame();
    await host.resolve(1);
    expect(source.read()).toMatchObject({
      sample: { completeness: "incomplete", metrics: null, omittedPasses: 1 },
    });
    source.dispose();
  });

  it("restores prototype methods and rejects an existing resolver before attaching", async () => {
    const host = fixture();
    Reflect.set(host.backend.timestampQueryPool, "render", { pendingResolve: Promise.resolve() });
    expect(() => createThreeWebGpuSource(host.renderer, { revision: "186" })).toThrow(
      "pending timestamp",
    );
    Reflect.set(host.backend.timestampQueryPool, "render", null);
    const inherited: typeof host.backend = Object.create(host.backend);
    const source = createThreeWebGpuSource(
      { ...host.renderer, backend: inherited },
      { revision: "186" },
    );
    source.dispose();
    expect(Object.hasOwn(inherited, "initTimestampQuery")).toBe(false);
    expect(Object.hasOwn(inherited, "resolveTimestampsAsync")).toBe(false);
    const unsupported = createThreeWebGpuSource(
      { ...host.renderer, backend: {} },
      { revision: "186" },
    );
    expect((await unsupported.resolveFrames([1], { timeoutMs: 0 })).status).toBe("unavailable");
    unsupported.dispose();
  });
  it("rolls back attachment if the device cannot accept a timestamp owner", () => {
    const host = fixture();
    const init = host.backend.initTimestampQuery;
    const resolve = host.backend.resolveTimestampsAsync;
    Object.defineProperty(host.device, "createCommandEncoder", { writable: false });
    expect(() => createThreeWebGpuSource(host.renderer, { revision: "186" })).toThrow();
    expect(host.backend.initTimestampQuery).toBe(init);
    expect(host.backend.resolveTimestampsAsync).toBe(resolve);
    expect(host.backend.trackTimestamp).toBe(true);
  });

  it("cleans up failed allocation and synchronous submission without unhandled rejections", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    host.device.createBuffer.mockImplementationOnce(() => {
      throw new Error("Allocation failed");
    });
    source.beginFrame(1);
    host.pass("render", "r:a:f1");
    source.endFrame();
    expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
    source.beginFrame(2);
    host.pass("compute", "c:b:f2");
    host.device.queue.submit.mockImplementationOnce(() => {
      throw new Error("Submit failed");
    });
    source.endFrame();
    await host.flush();
    expect(source.read()).toMatchObject({ status: "error", message: "Submit failed" });
    expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
    source.dispose();
  });

  it("keeps nested labels, zero-duration passes, and read-only host descriptors intact", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    source.beginFrame(1);
    source.withPass({ id: "outer", label: "Outer" }, () => {
      source.withPass({ id: "inner", label: "Inner" }, () => {
        host.pass("compute", "c:a:f1", [100n, 100n]);
      });
      const descriptor: GPURenderPassDescriptor = { colorAttachments: [] };
      Object.defineProperty(descriptor, "timestampWrites", { value: undefined, writable: false });
      Object.freeze(descriptor);
      host.device.createCommandEncoder().beginRenderPass(descriptor);
      const writes = host.descriptors.at(-1)?.timestampWrites;
      if (writes) {
        host.write(writes, 100n, 200n);
      }
      expect(descriptor.timestampWrites).toBeUndefined();
    });
    source.endFrame();
    await host.resolve();
    expect(source.read()).toMatchObject({
      sample: {
        completeness: "complete",
        passes: [
          { id: "inner", startNs: 0, endNs: 0 },
          { id: "outer", startNs: 0, endNs: 100 },
        ],
      },
    });
    source.dispose();
  });

  it("preserves a host replacement and does not revive after disposal or later device loss", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    const replacement = vi.fn();
    host.backend.initTimestampQuery = replacement;
    host.backend.trackTimestamp = false;
    source.beginFrame(1);
    expect(source.read()).toMatchObject({
      status: "error",
      message: expect.stringContaining("ownership"),
    });
    source.dispose();
    expect(host.backend.initTimestampQuery).toBe(replacement);
    expect(host.backend.trackTimestamp).toBe(false);
    await host.lose();
    source.setEnabled(true);
    source.beginFrame(2);
    source.endFrame();
    expect(source.read().status).toBe("disabled");
  });

  it("reports observer failures and allows observer-driven disposal without leaking slots", async () => {
    const host = fixture();
    const onSample = vi.fn().mockImplementationOnce(() => {
      throw new Error("Observer failed");
    });
    const source = createThreeWebGpuSource(host.renderer, {
      revision: "186",
      enabled: true,
      onSample,
    });
    source.beginFrame(1);
    host.pass("render", "r:a:f1");
    source.endFrame();
    await host.resolve();
    expect(source.read()).toMatchObject({ status: "error", message: "Observer failed" });
    onSample.mockImplementationOnce(() => source.dispose());
    source.beginFrame(2);
    host.pass("compute", "c:b:f2");
    source.endFrame();
    await host.resolve(1);
    expect(source.read().status).toBe("disabled");
    expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
  });
  it("captures every native layer and utility pass even when Three reuses one timestamp descriptor", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    source.beginFrame(1);
    const descriptor: { timestampWrites?: GPURenderPassTimestampWrites } = {};
    host.backend.initTimestampQuery("render", "r:1:cube:f1", descriptor);
    const encoder = host.device.createCommandEncoder();
    for (const start of [100n, 200n]) {
      encoder.beginRenderPass({ ...descriptor, colorAttachments: [] });
      const writes = host.descriptors.at(-1)?.timestampWrites;
      if (writes) {
        host.write(writes, start, start + 10n);
      }
    }
    // Utility passes need not call Three's timestamp initializer at all.
    encoder.beginComputePass({});
    const writes = host.descriptors.at(-1)?.timestampWrites;
    if (writes) {
      host.write(writes, 110n, 120n);
    }
    source.endFrame();
    await host.resolve();
    expect(source.read()).toMatchObject({
      sample: {
        expectedPasses: 3,
        omittedPasses: 0,
        metrics: { renderSumMs: 0.00002, computeSumMs: 0.00001, busyMs: 0.00003 },
      },
    });
    source.dispose();
  });
  it("starts disabled, owns both timestamp paths exclusively, and restores host configuration", async () => {
    const host = fixture();
    const init = host.backend.initTimestampQuery;
    const resolve = host.backend.resolveTimestampsAsync;
    const source = createThreeWebGpuSource(host.renderer, { revision: "186" });
    expect(source.read().status).toBe("disabled");
    source.beginFrame(1);
    expect(host.pass("compute", "c:fft:f0").timestampWrites).toBeUndefined();
    source.endFrame();
    expect(host.resources().buffers).toBe(0);
    expect(() => createThreeWebGpuSource(host.renderer, { revision: "186" })).toThrow("owns");
    await expect(host.renderer.resolveTimestampsAsync()).rejects.toThrow("owns");
    source.dispose();
    source.dispose();
    expect(host.backend.initTimestampQuery).toBe(init);
    expect(host.backend.resolveTimestampsAsync).toBe(resolve);
    expect(host.backend.trackTimestamp).toBe(true);
    expect(await host.renderer.resolveTimestampsAsync()).toBe(123);
  });

  it("associates compute through final render with one application frame and preserves repeated labels", async () => {
    const host = fixture();
    const samples: GpuState[] = [];
    const source = createThreeWebGpuSource(host.renderer, {
      revision: "186",
      enabled: true,
      onSample: (state) => samples.push(state),
    });
    source.beginFrame(101);
    const origin = 18_446_744_000_000_000_000n;
    source.withPass({ id: "fft", label: "Ocean FFT", category: "water" }, () => {
      host.pass("compute", "c:1:fft:f7", [origin, origin + 4_000_000n]);
      host.pass("compute", "c:1:fft:f7", [origin + 7_000_000n, origin + 9_000_000n]);
    });
    source.withPass({ id: "scene", label: "Main Scene" }, () => {
      host.pass("render", "r:1:scene:f8", [origin + 2_000_000n, origin + 6_000_000n]);
    });
    source.endFrame();
    expect(source.read().status).toBe("pending");
    expect(host.renderer.resolveTimestampsAsync).not.toBe(host.backend.resolveTimestampsAsync);
    await host.resolve();
    expect(samples).toHaveLength(1);
    expect(source.read()).toMatchObject({
      status: "ready",
      sample: {
        frameId: 101,
        sequence: 1,
        rendererFrameId: 8,
        completeness: "complete",
        clock: { originNs: origin.toString(), unit: "nanoseconds" },
        metrics: {
          renderSumMs: 4,
          computeSumMs: 6,
          combinedSumMs: 10,
          busyMs: 8,
          elapsedSpanMs: 9,
        },
        passes: [
          { id: "fft", invocation: 1, type: "compute", category: "water", rendererFrameId: 7 },
          { id: "fft", invocation: 2, type: "compute", category: "water", rendererFrameId: 7 },
          { id: "scene", invocation: 3, type: "render", category: null, rendererFrameId: 8 },
        ],
      },
    });
    source.dispose();
    expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
  });

  it("preserves compute-only and render-only results arriving out of order without using simulation time", async () => {
    const host = fixture();
    const samples: GpuState[] = [];
    const source = createThreeWebGpuSource(host.renderer, {
      revision: "186",
      enabled: true,
      onSample: (state) => samples.push(state),
    });
    source.beginFrame(101);
    host.pass("compute", "c:fft:f0");
    source.endFrame();
    source.beginFrame(102);
    host.pass("render", "r:scene:f0");
    source.captureFrame(102);
    await host.resolve(1);
    await host.resolve(0);
    expect(samples.map((state) => state.status === "ready" && state.sample.frameId)).toEqual([
      102, 101,
    ]);
    expect(source.read()).toMatchObject({
      sample: { frameId: 102, metrics: { computeSumMs: 0, renderSumMs: 0.00001 } },
    });
    source.beginFrame(103);
    source.endFrame();
    expect(source.read()).toMatchObject({
      sample: { frameId: 103, metrics: { busyMs: 0 }, expectedPasses: 0 },
    });
    source.dispose();
  });

  it("bounds query capacity and queue pressure without pretending partial sums are frame totals", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, {
      revision: "186",
      enabled: true,
      maxPasses: 2,
      maxPendingFrames: 1,
    });
    source.beginFrame(1);
    host.pass("render", "r:a:f1");
    host.pass("compute", "c:b:f1");
    expect(host.pass("render", "r:c:f1").timestampWrites).toBeUndefined();
    source.endFrame();
    source.beginFrame(2);
    expect(host.pass("render", "r:d:f2").timestampWrites).toBeUndefined();
    source.endFrame();
    expect(source.read()).toMatchObject({
      sample: {
        frameId: 2,
        completeness: "incomplete",
        metrics: null,
        omittedPasses: 1,
        issues: ["queue-pressure"],
      },
    });
    await host.resolve();
    const result = await source.resolveFrames([1, 2], { timeoutMs: 50 });
    expect(result.samples).toMatchObject([
      {
        frameId: 1,
        completeness: "incomplete",
        omittedPasses: 1,
        metrics: null,
        issues: ["query-capacity"],
      },
      { frameId: 2, completeness: "incomplete", issues: ["queue-pressure"] },
    ]);
    expect(host.resources()).toMatchObject({ buffers: 2, queries: 1 });
    source.dispose();
  });

  it.each([
    [0n, 0n],
    [100n, 90n],
    [1n, 70_000_000_001n],
  ])(
    "keeps unavailable or invalid timestamps out of complete totals: %s → %s",
    async (start, end) => {
      const host = fixture();
      const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
      source.beginFrame(null);
      host.pass("compute", "unknown", [start, end]);
      source.endFrame();
      await host.resolve();
      expect(source.read()).toMatchObject({
        sample: { frameId: null, completeness: "incomplete", metrics: null, omittedPasses: 1 },
      });
      source.dispose();
    },
  );

  it("ignores late results on disable, disposal and device loss without disposing host resources", async () => {
    const host = fixture();
    const onSample = vi.fn();
    const source = createThreeWebGpuSource(host.renderer, {
      revision: "186",
      enabled: true,
      onSample,
    });
    source.beginFrame(1);
    host.pass("compute", "c:a:f0");
    source.endFrame();
    source.setEnabled(false);
    source.setEnabled(true);
    await host.resolve();
    expect(onSample).not.toHaveBeenCalled();
    source.beginFrame(2);
    host.pass("render", "r:a:f1");
    source.endFrame();
    await host.lose();
    await host.resolve(1);
    expect(source.read()).toMatchObject({
      status: "error",
      message: expect.stringContaining("device lost"),
    });
    source.setEnabled(true);
    source.dispose();
    source.dispose();
    expect(onSample).not.toHaveBeenCalled();
    expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
    expect(host.backend.trackTimestamp).toBe(true);
  });

  it("times out readbacks, releases slots and reports read failures explicitly", async () => {
    vi.useFakeTimers();
    try {
      const host = fixture();
      const source = createThreeWebGpuSource(host.renderer, {
        revision: "186",
        enabled: true,
        readbackTimeoutMs: 100,
      });
      source.beginFrame(1);
      host.pass("render", "r:a:f1");
      source.endFrame();
      await vi.advanceTimersByTimeAsync(101);
      expect(source.read()).toMatchObject({
        status: "error",
        message: expect.stringContaining("timed out"),
      });
      expect(host.resources()).toMatchObject({ buffers: 0, queries: 0 });
      source.beginFrame(2);
      host.pass("compute", "c:b:f2");
      source.endFrame();
      await host.reject(new Error("Map failed"), 1);
      expect(source.read()).toMatchObject({ status: "error", message: "Map failed" });
      source.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses resources, bounds retained frames, and returns detached resolved samples", async () => {
    const host = fixture();
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    for (let frame = 1; frame <= 140; frame += 1) {
      source.beginFrame(frame);
      host.pass("render", "r:a:f0");
      source.endFrame();
      await host.resolve(frame - 1);
    }
    expect(host.resources()).toMatchObject({
      buffers: 2,
      queries: 1,
      createdBuffers: 2,
      createdQueries: 1,
    });
    expect(source.diagnostics()).toMatchObject({
      pendingFrames: 0,
      retainedFrames: 128,
      allocatedSlots: 1,
    });
    const result = await source.resolveFrames([1, 140], { timeoutMs: 0 });
    expect(result.samples).toHaveLength(1);
    Reflect.set(result.samples[0]?.passes[0] ?? {}, "label", "changed");
    expect(source.read()).not.toMatchObject({ sample: { passes: [{ label: "changed" }] } });
    source.dispose();
  });

  it("validates frame windows, labels, feature support and revision without changing host resources", () => {
    const host = fixture();
    expect(() => createThreeWebGpuSource(host.renderer, { revision: "185" })).toThrow("r186");
    host.renderer.initialized = false;
    expect(() => createThreeWebGpuSource(host.renderer, { revision: "186" })).toThrow("init");
    host.renderer.initialized = true;
    const source = createThreeWebGpuSource(host.renderer, { revision: "186", enabled: true });
    expect(() => source.beginFrame(0)).toThrow(RangeError);
    expect(() => source.captureFrame(1)).toThrow("beginFrame");
    source.beginFrame(1);
    expect(() => source.beginFrame(2)).toThrow("endFrame");
    expect(() => source.withPass({ id: "", label: "pass" }, () => {})).toThrow();
    expect(() => source.captureFrame(2)).toThrow("frame");
    source.endFrame();
    expect(() => source.beginFrame(1)).toThrow("increase");
    source.dispose();
    host.renderer.hasFeature.mockReturnValue(false);
    const unsupported = createThreeWebGpuSource(host.renderer, { revision: "186" });
    expect(unsupported.read().status).toBe("unsupported");
    unsupported.beginFrame(1);
    unsupported.endFrame();
    unsupported.setEnabled(true);
    unsupported.dispose();
  });
});
