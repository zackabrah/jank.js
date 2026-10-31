import {
  createLoadingProfiler,
  type LoadingOperation,
  type LoadingRun,
} from "../../packages/jank/src/index.ts";

/** Real measured host work and two overlapping waits; no fabricated network/cache observations. */
export function createLoadingExample() {
  const source = createLoadingProfiler();
  let pending: {
    run: LoadingRun;
    first: LoadingOperation;
    second: LoadingOperation;
    startedAtMs: number;
  } | null = null;
  return {
    source,
    initialize: <T>(prepare: () => T): T => {
      const run = source.beginRun({ label: "Initial scene creation", kind: "fresh-context" });
      try {
        const scene = run.measure("scene creation", prepare);
        run.finish("ready");
        return scene;
      } catch (error) {
        run.finish("failed");
        throw error;
      }
    },
    start: (prepare: () => void) => {
      const run = source.beginRun({ label: "Scene reset and host waits", kind: "repeat-session" });
      pending = null;
      try {
        run.measure("reset cubes", prepare);
      } catch (error) {
        run.finish("failed");
        throw error;
      }
      pending = {
        run,
        first: run.startStage("host wait"),
        second: run.startStage("host wait"),
        startedAtMs: performance.now(),
      };
    },
    step: (atMs: number) => {
      if (!pending) {
        return;
      }
      const elapsedMs = atMs - pending.startedAtMs;
      if (elapsedMs >= 100) {
        pending.first.finish();
      }
      if (elapsedMs >= 200) {
        pending.second.finish();
        pending.run.finish("ready");
        pending = null;
      }
    },
    cancel: () => {
      pending?.run.finish("cancelled");
      pending = null;
    },
  };
}
