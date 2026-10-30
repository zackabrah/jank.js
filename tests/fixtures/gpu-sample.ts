import type { GpuIntervalSample } from "../../packages/jank/src/core/gpu.ts";

export function gpuIntervalFixture(): GpuIntervalSample {
  return {
    measurement: "intervals",
    frameId: 1,
    rendererFrameId: 8,
    sequence: 1,
    clock: {
      id: "test-device",
      domain: "webgpu-timestamp",
      unit: "nanoseconds",
      originNs: "18446744000000000000",
    },
    expectedPasses: 3,
    omittedPasses: 0,
    completeness: "complete",
    issues: [],
    rejectedPasses: [],
    metrics: { renderSumMs: 4, computeSumMs: 6, combinedSumMs: 10, busyMs: 8, elapsedSpanMs: 9 },
    passes: [
      {
        id: "fft",
        label: "Ocean FFT",
        type: "compute",
        category: "water",
        invocation: 1,
        rendererFrameId: 7,
        startNs: 0,
        endNs: 4_000_000,
      },
      {
        id: "scene",
        label: "Main Scene",
        type: "render",
        category: null,
        invocation: 2,
        rendererFrameId: 8,
        startNs: 2_000_000,
        endNs: 6_000_000,
      },
      {
        id: "fft",
        label: "Ocean FFT",
        type: "compute",
        category: "water",
        invocation: 3,
        rendererFrameId: 8,
        startNs: 7_000_000,
        endNs: 9_000_000,
      },
    ],
  };
}
