import type { GpuFrame, GpuInvocation } from "./model.ts";

/** Explicit test/review evidence; never used by the live collector. */
export function gpuFixture(frameId = 1, state: GpuInvocation["state"] = "timed"): GpuFrame {
  return {
    frameId,
    source: "host",
    clock: "gpu",
    epoch: 0,
    resolutionMs: 0.1,
    inventory: "complete",
    omitted: 0,
    invocations: [
      {
        id: "scene:0",
        label: "Scene",
        kind: "render",
        state,
        milliseconds: state === "timed" ? 0 : null,
        startMs: state === "timed" ? 0 : null,
        endMs: state === "timed" ? 0 : null,
        reason:
          state === "rejected" ? "GPU counter reset" : state === "omitted" ? "GPU pool full" : null,
      },
    ],
  };
}
