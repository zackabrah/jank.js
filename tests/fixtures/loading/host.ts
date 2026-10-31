import {
  createLoadingProfiler,
  createPanel,
  createProfiler,
} from "../../../packages/jank/src/index.ts";
import "../../../packages/jank/src/panel/panel.css";

let timeMs = 0;
const loading = createLoadingProfiler({ now: () => timeMs });
const profiler = createProfiler({ now: () => timeMs });
const panel = createPanel({
  container: document.body,
  profiler,
  loading,
  mode: "full",
  corner: "top-left",
});
const fixture = {
  loading,
  panel,
  at: (value: number) => {
    timeMs = value;
    panel.refresh(timeMs);
  },
  cold: () => {
    const run = loading.beginRun({ label: "Scene cold", kind: "fresh-context" });
    const first = run.startStage("fetch");
    first.recordCache("miss");
    first.addReceivedBytes(2048);
    timeMs = 100;
    const second = run.startStage("fetch");
    second.recordCache("in-flight");
    timeMs = 300;
    first.finish();
    timeMs = 500;
    second.finish();
    run.finish("ready");
    panel.refresh(timeMs);
  },
};
declare global {
  interface Window {
    loadingFixture: typeof fixture;
  }
}
window.loadingFixture = fixture;
