const packagePath = "/packages/jank/dist/index.js";
const { createPanel, createProfiler }: typeof import("../../../packages/jank/src/index.ts") =
  await import(/* @vite-ignore */ packagePath);
let timeMs = 0;
const profiler = createProfiler({ now: () => timeMs });
const panel = createPanel({ container: document.body, profiler, mode: "full" });
profiler.capture.start();
for (let frame = 0; frame <= 70; frame += 1) {
  timeMs = frame * 16.7;
  profiler.beginFrame(timeMs);
  panel.refresh(timeMs);
}
profiler.capture.stop();
panel.refresh(timeMs + 300);

export {};
