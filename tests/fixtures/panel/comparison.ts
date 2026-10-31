import { createComparison, createPanel, createProfiler } from "../../../packages/jank/src/index.ts";

declare global {
  interface Window {
    comparisonFixture: {
      advance(count: number): Promise<void>;
      restored(): number;
      dispose(): void;
    };
  }
}
export function mountComparisonFixture(): void {
  window.panelFixture.panel.dispose();
  let now = 0;
  let variant = "A";
  let restores = 0;
  const profiler = createProfiler({ now: () => now });
  const comparison = createComparison({
    profiler,
    host: {
      begin: () => ({
        apply: (next) => {
          variant = next;
          return {
            label: `Scene ${next}`,
            settings: [{ label: "Objects", value: next === "A" ? 64 : 128 }],
            resolution: { widthPx: 800, heightPx: 600 },
            animation: "frozen",
          };
        },
        restore: () => {
          restores++;
        },
      }),
    },
  });
  const panel = createPanel({ container: document.body, profiler, comparison, mode: "full" });
  window.comparisonFixture = {
    async advance(count) {
      for (let index = 0; index < count; index++) {
        now += 16;
        const id = profiler.beginFrame(now);
        comparison.tick(now, id);
        profiler.endFrame({ updateMs: variant === "A" ? 2 : 4, renderMs: 1 });
        await Promise.resolve();
      }
      panel.refresh(now);
    },
    restored: () => restores,
    dispose: () => panel.dispose(),
  };
}
