import {
  createPanel,
  createProfiler,
  type Panel,
  type PanelMode,
  type Profiler,
} from "../../../packages/jank/src/index.ts";

declare global {
  interface Window {
    panelFixture: {
      readonly profiler: Profiler;
      panel: Panel;
      advance(count: number, intervalMs?: number): void;
      refresh(): void;
      mount(mode?: PanelMode): void;
    };
  }
}

const container = document.querySelector<HTMLElement>("#panel-container");
if (!container) {
  throw new Error("Missing panel container");
}
let timeMs = 0;
const profiler = createProfiler({ now: () => timeMs, application: { name: "Panel fixture" } });
const physics = profiler.createChannel({
  id: "physics",
  label: "physics",
  readCounters: () => ({ bodies: 123, pending: null }),
});
const render = profiler.createChannel({ id: "render", label: "render submit" });
const parameter = new URLSearchParams(location.search).get("mode");
const mode = parameter === "mini" || parameter === "full" ? parameter : "line";

window.panelFixture = {
  profiler,
  panel: createPanel({ container, profiler, mode }),
  advance: (count, intervalMs = 16.7) => {
    for (let index = 0; index < count; index += 1) {
      const startMs = timeMs;
      profiler.beginFrame(timeMs);
      const token = physics.begin();
      timeMs += 2;
      physics.end(token);
      const renderToken = render.begin();
      timeMs += 1;
      render.end(renderToken);
      profiler.endFrame({ updateMs: 2, renderMs: 1 });
      timeMs = startMs + intervalMs;
    }
    profiler.beginFrame(timeMs);
    window.panelFixture.panel.refresh(timeMs);
  },
  refresh: () => {
    timeMs += 300;
    window.panelFixture.panel.refresh(timeMs);
  },
  mount: (nextMode = "line") => {
    window.panelFixture.panel.dispose();
    window.panelFixture.panel = createPanel({ container, profiler, mode: nextMode });
    window.panelFixture.refresh();
  },
};
window.panelFixture.panel.refresh(timeMs);
document
  .querySelector("#collect")
  ?.addEventListener("click", () => window.panelFixture.advance(70));
document.querySelector("#slow")?.addEventListener("click", () => {
  window.panelFixture.advance(1, 40);
  window.panelFixture.refresh();
});
document.body.dataset.ready = "true";
