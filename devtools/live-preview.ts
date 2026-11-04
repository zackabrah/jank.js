import type { SavedCapture } from "../src/capture/controller.ts";
import { createPerformancePanel } from "../src/panel-api.ts";
import { loadReferenceMonitor } from "./reference-monitor.ts";

/** The real collector, in development only; the host owns its loop. */
export async function startLivePreview(
  container: HTMLElement,
  onError: (message: string) => void,
  onOpen: (capture: SavedCapture) => void | Promise<void>,
) {
  const monitor = await loadReferenceMonitor("Jank browser simulation");
  const panel = createPerformancePanel({
    shell: container,
    corner: "none",
    monitor,
    instrumentation: () => ({ traceEvents: monitor.traceEvents }),
    onOpenCapture: onOpen,
  });
  const particles = new Float64Array(2048);
  let steps = 0;
  const channel = monitor.register("simulation", "Simulation", () => ({
    particles: particles.length,
    steps,
  }));
  let request = 0;
  let stopped = false;
  const destroy = () => {
    stopped = true;
    cancelAnimationFrame(request);
    panel.destroy();
    monitor.dispose();
  };
  const frame = () => {
    if (stopped) return;
    try {
      monitor.beginFrame(performance.now());
      const start = performance.now();
      const token = channel.begin();
      for (let i = 0; i < particles.length; i++)
        particles[i] = Math.sin((particles[i] ?? 0) + i + steps);
      steps++;
      channel.end(token);
      monitor.endFrame(performance.now() - start, 0);
      panel.refresh(performance.now());
      request = requestAnimationFrame(frame);
    } catch (error) {
      destroy();
      onError(error instanceof Error ? error.message : "Live preview failed");
    }
  };
  frame();
  return destroy;
}
