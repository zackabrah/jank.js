import {
  createWebGl2GpuSource,
  type WebGl2GpuSource,
} from "../../packages/jank/src/adapters/webgl2.ts";
import type { GpuSource, GpuState } from "../../packages/jank/src/index.ts";
import { createGpuExample, type GpuExample } from "./example-sources.ts";

export type DemoGpuMode = "webgl2" | GpuExample;

/** The real renderer timer is the default; synthetic states remain opt-in UI examples. */
export function createDemoGpu(
  context: WebGL2RenderingContext | null,
  onSample: (state: GpuState) => void,
) {
  const example = createGpuExample();
  let mode: DemoGpuMode = "webgl2";
  let timer: WebGl2GpuSource | null = null;

  function select(next: DemoGpuMode): void {
    mode = next;
    timer?.setEnabled(mode === "webgl2");
    example.select(mode === "webgl2" ? "disabled" : mode);
  }

  const source: GpuSource = {
    label: "WebGL2 GPU timer (simulated examples are labelled)",
    read: () =>
      mode === "webgl2"
        ? (timer?.read() ?? { status: "unsupported", reason: "WebGL renderer unavailable" })
        : example.source.read(),
    setEnabled: (enabled) => select(enabled ? "webgl2" : "disabled"),
  };

  return {
    source,
    select,
    mode: () => mode,
    reset: () => {
      timer?.dispose();
      timer = context
        ? createWebGl2GpuSource(context, { enabled: mode === "webgl2", onSample })
        : null;
      example.reset();
    },
    beginPass: () => {
      if (mode === "webgl2") {
        timer?.beginPass("scene render");
      }
    },
    endPass: () => {
      if (mode === "webgl2") {
        timer?.endPass();
      }
    },
    observe: (frameId: number, hostFrame: number): GpuState => {
      if (mode !== "webgl2") {
        return example.observe(frameId, hostFrame);
      }
      timer?.captureFrame(frameId > 0 ? frameId : null);
      return source.read();
    },
    dispose: () => timer?.dispose(),
  };
}
