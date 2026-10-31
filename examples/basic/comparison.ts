import {
  type Comparison,
  type ComparisonContext,
  type ComparisonHost,
  createComparison as createJankComparison,
  type Profiler,
} from "../../packages/jank/src/index.ts";
import type { createDemoGpu } from "./gpu-source.ts";
import type { createScene } from "./scene.ts";

interface SceneSettings {
  readonly objects: number;
  readonly cpuMs: number;
  readonly animate: boolean;
  readonly scale: number;
}
interface DemoHost {
  readonly scene: ReturnType<typeof createScene> | null;
  readonly gpu: ReturnType<typeof createDemoGpu>;
  readonly canvas: HTMLCanvasElement;
  readonly profiler: () => Profiler | null;
  readonly canStart: () => boolean;
  readonly settings: () => SceneSettings;
}
function readSettings(variant: "a" | "b"): SceneSettings {
  const read = (name: string) =>
    document.querySelector<HTMLInputElement | HTMLSelectElement>(`#comparison-${variant}-${name}`);
  return {
    objects: Number(read("objects")?.value),
    cpuMs: Number(read("cpu")?.value),
    scale: Number(read("scale")?.value),
    animate:
      document.querySelector<HTMLInputElement>(`#comparison-${variant}-animate`)?.checked ?? false,
  };
}
/** Only scene configuration and restoration live in the demo; Jank owns measurement and UI. */
export function createComparison(host: DemoHost) {
  let controller: Comparison | null = null;
  let owner: Profiler | null = null;
  let current: SceneSettings | undefined;
  const disabled = new Map<HTMLButtonElement | HTMLInputElement | HTMLSelectElement, boolean>();
  function lock(): void {
    for (const control of disabled.keys()) {
      control.disabled = true;
    }
  }
  const comparisonHost: ComparisonHost = {
    begin: () => {
      const scene = host.scene;
      if (!scene || !host.canStart()) {
        throw new Error("Finish the current workload before comparing.");
      }
      const original = host.settings();
      const time = scene.animationTime();
      const gpuMode = host.gpu.mode();
      const variants = { A: readSettings("a"), B: readSettings("b") };
      const width = host.canvas.clientWidth;
      const height = host.canvas.clientHeight;
      const ratio = devicePixelRatio;
      for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >(".demo-controls button, .demo-controls input, .demo-controls select")) {
        disabled.set(control, control.disabled);
      }
      lock();
      return {
        apply(variant): ComparisonContext {
          current = variants[variant];
          scene.clearStress(current.objects);
          scene.setResolutionScale(current.scale);
          scene.setAnimationTime(0);
          host.gpu.select("webgl2");
          host.gpu.reset();
          return {
            label: `Basic demo ${variant}`,
            settings: [
              { label: "Objects", value: current.objects },
              { label: "Extra CPU ms", value: current.cpuMs },
              { label: "Resolution scale", value: current.scale },
              { label: "GPU", value: "WebGL2 elapsed scene render" },
            ],
            resolution: { widthPx: host.canvas.width, heightPx: host.canvas.height },
            animation: current.animate
              ? "Animated; reset to time zero before warm-up"
              : "Frozen at time zero",
          };
        },
        check: () => {
          if (
            host.canvas.clientWidth !== width ||
            host.canvas.clientHeight !== height ||
            devicePixelRatio !== ratio
          ) {
            return "Viewport changed; restart with a fixed resolution.";
          }
          if (scene.context.isContextLost()) {
            return "GPU context lost; restart the comparison.";
          }
          return null;
        },
        restore: () => {
          current = undefined;
          scene.clearStress(original.objects);
          scene.setResolutionScale(original.scale);
          scene.setAnimationTime(time);
          host.gpu.select(gpuMode);
          for (const [control, wasDisabled] of disabled) {
            control.disabled = wasDisabled;
          }
          disabled.clear();
        },
      };
    },
  };
  function getController(): Comparison | undefined {
    const profiler = host.profiler();
    if (profiler !== owner) {
      controller?.dispose();
      controller = profiler ? createJankComparison({ profiler, host: comparisonHost }) : null;
      owner = profiler;
    }
    return controller ?? undefined;
  }
  return {
    controller: getController,
    active: () => controller?.isRunning() ?? false,
    settings: () => current,
    beforeFrame: (atMs: number, frameId: number) => controller?.tick(atMs, frameId),
    refresh: lock,
    cancel: (reason: string) => controller?.cancel(reason),
    dispose: () => controller?.dispose(),
  };
}
