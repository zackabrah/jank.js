import { describe, expect, it, vi } from "vitest";
import { webGpuDeviceFixture } from "../../../../tests/fixtures/webgpu-device.ts";
import { runWebGpuTimestampDiagnostic } from "./webgpu-diagnostic.ts";

function fixture(
  pairs = [
    [10n, 20n],
    [30n, 20n],
    [40n, 20n],
    [50n, 60n],
    [70n, 0n],
    [80n, 90n],
  ],
) {
  const gpu = webGpuDeviceFixture();
  let index = 0;
  const destroy = vi.fn();
  const draw = vi.fn();
  const device = {
    ...gpu.device,
    features: new Set(["timestamp-query"]),
    createTexture: vi.fn(() => ({ destroy, createView: () => ({ label: "test-view" }) })),
    createShaderModule: () => ({
      label: "test-shader",
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createRenderPipeline: () => ({
      label: "test-pipeline",
      getBindGroupLayout: () => ({ label: "test-layout" }),
    }),
    createCommandEncoder: () => ({
      ...gpu.device.createCommandEncoder(),
      beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
        gpu.descriptors.push(descriptor);
        const pair = pairs[index++];
        if (!descriptor.timestampWrites || !pair) {
          throw new Error("Missing test pair");
        }
        gpu.write(descriptor.timestampWrites, pair[0] ?? 0n, pair[1] ?? 0n);
        return { setPipeline: vi.fn(), draw, end: vi.fn() };
      },
    }),
  };
  return { ...gpu, device, destroy, draw };
}

describe("explicit WebGPU timestamp diagnostic", () => {
  it("retains reversed and zero endpoints, tests fresh/reused queries, and releases only owned resources", async () => {
    const gpu = fixture();
    const result = runWebGpuTimestampDiagnostic(gpu.device);
    for (let index = 0; index < 6; index++) {
      await gpu.flush();
      await gpu.resolve(index);
    }
    const report = await result;
    expect(report.status).toBe("finished");
    expect(report.pairs.map((pair) => pair.reason)).toEqual([
      null,
      "reversed-timestamp",
      "reversed-timestamp",
      null,
      "zero-timestamp",
      null,
    ]);
    expect(report.pairs[1]).toMatchObject({ startNs: "30", endNs: "20", durationMs: null });
    expect(report.pairs[0]?.durationMs).toBe(0.00001);
    expect(report.pairs.map((pair) => pair.query)).toEqual([
      "reused",
      "reused",
      "reused",
      "reused",
      "fresh",
      "fresh",
    ]);
    expect(gpu.draw).toHaveBeenCalledTimes(3);
    expect(gpu.resources()).toMatchObject({ buffers: 0, queries: 0 });
    expect(gpu.destroy).toHaveBeenCalledOnce();
  });

  it("does not allocate when timestamp-query was not enabled on the device", async () => {
    const gpu = fixture();
    gpu.device.features.clear();
    expect(await runWebGpuTimestampDiagnostic(gpu.device)).toMatchObject({
      status: "unsupported",
      pairs: [],
    });
    expect(gpu.device.createTexture).not.toHaveBeenCalled();
    expect(gpu.resources()).toMatchObject({ createdQueries: 0 });
  });

  it("keeps completed pairs when readback fails and releases pending resources", async () => {
    const gpu = fixture();
    const result = runWebGpuTimestampDiagnostic(gpu.device);
    await gpu.flush();
    await gpu.resolve();
    await gpu.reject(new Error("map failed"), 1);
    expect(await result).toMatchObject({
      status: "failed",
      error: "map failed",
      pairs: [{ startNs: "10" }],
    });
    expect(gpu.resources()).toMatchObject({ buffers: 0, queries: 0 });
    expect(gpu.destroy).toHaveBeenCalledOnce();
  });

  it("times out without leaving a mapped buffer or query", async () => {
    vi.useFakeTimers();
    try {
      const gpu = fixture();
      const result = runWebGpuTimestampDiagnostic(gpu.device, { timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(11);
      expect(await result).toMatchObject({ status: "failed", pairs: [] });
      expect(gpu.resources()).toMatchObject({ buffers: 0, queries: 0 });
      expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up partial allocation and reports setup errors", async () => {
    const gpu = fixture();
    gpu.device.createBuffer.mockImplementationOnce(() => {
      throw new Error("allocation failed");
    });
    expect(await runWebGpuTimestampDiagnostic(gpu.device)).toMatchObject({
      status: "failed",
      error: "allocation failed",
    });
    expect(gpu.resources()).toMatchObject({ buffers: 0, queries: 0 });
    expect(gpu.destroy).toHaveBeenCalledOnce();
  });

  it("retains missing values if a transport returns a truncated mapping", async () => {
    const gpu = fixture();
    const result = runWebGpuTimestampDiagnostic(gpu.device);
    await gpu.flush();
    const mapped = gpu.reads[0]?.buffer;
    if (!mapped) {
      throw new Error("Missing pending mapping");
    }
    vi.spyOn(mapped, "getMappedRange").mockReturnValue(new ArrayBuffer(0));
    await gpu.resolve();
    await gpu.reject(new Error("stop after truncated result"), 1);
    expect((await result).pairs[0]).toMatchObject({
      startNs: null,
      endNs: null,
      durationMs: null,
      reason: "missing-timestamp",
    });
    expect(gpu.resources()).toMatchObject({ buffers: 0, queries: 0 });
  });

  it("reports non-Error native failures without allocating further resources", async () => {
    const gpu = fixture();
    gpu.device.createTexture.mockImplementationOnce(() => {
      throw "device unavailable";
    });
    expect(await runWebGpuTimestampDiagnostic(gpu.device)).toMatchObject({
      status: "failed",
      error: "device unavailable",
    });
    expect(gpu.resources()).toMatchObject({ createdQueries: 0 });
  });

  it.each([0, -1, NaN, Infinity, 30001])(
    "rejects invalid timeout %s before allocating",
    async (timeoutMs) => {
      const gpu = fixture();
      await expect(runWebGpuTimestampDiagnostic(gpu.device, { timeoutMs })).rejects.toThrow(
        "timeoutMs",
      );
      expect(gpu.device.createTexture).not.toHaveBeenCalled();
    },
  );
});
