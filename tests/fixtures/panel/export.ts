import { createPanel, type GpuFrameResolver } from "../../../packages/jank/src/index.ts";
import { gpuIntervalFixture } from "../gpu-sample.ts";

declare global {
  interface Window {
    exportFixture: { release(): void; requested(): readonly number[]; calls(): number };
  }
}
export function mountExportFixture(mode: "deferred" | "timeout" | "error", timeoutMs = 2000): void {
  const { profiler } = window.panelFixture;
  window.panelFixture.panel.dispose();
  let release: (() => void) | null = null;
  let requested: readonly number[] = [];
  let calls = 0;
  const gpuResolver: GpuFrameResolver = {
    resolveFrames: (ids) => {
      calls += 1;
      requested = [...ids];
      if (mode === "error") {
        throw new Error("Device readback failed");
      }
      return new Promise((resolve) => {
        release = () =>
          resolve({
            status: "settled",
            pendingFrameIds: [],
            samples: ids.map((frameId) => ({
              ...gpuIntervalFixture(),
              frameId,
              sequence: frameId,
            })),
          });
      });
    },
  };
  window.panelFixture.panel = createPanel({
    container: document.body,
    profiler,
    mode: "full",
    gpuResolver,
    exportTimeoutMs: timeoutMs,
  });
  window.panelFixture.panel.setMode("full");
  window.exportFixture = {
    release: () => release?.(),
    requested: () => requested,
    calls: () => calls,
  };
}
