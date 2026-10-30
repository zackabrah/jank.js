import type {
  GpuSource,
  GpuState,
  LoadingSnapshot,
  LoadingSource,
  TraceSink,
} from "../../packages/jank/src/index.ts";

export type GpuExample = "disabled" | "synthetic" | "pending" | "unsupported" | "error";

/** Deliberately fabricated input for testing the optional GPU UI, not a renderer adapter. */
export function createGpuExample() {
  let mode: GpuExample = "disabled";
  let state: GpuState = { status: "disabled" };
  const recentIds: number[] = [];
  function select(next: GpuExample): void {
    mode = next;
    recentIds.length = 0;
    if (mode === "unsupported") {
      state = { status: "unsupported", reason: "Example: GPU timing unsupported" };
    } else if (mode === "error") {
      state = { status: "error", message: "Example: GPU query failed" };
    } else {
      state = { status: mode === "disabled" ? "disabled" : "pending" };
    }
  }
  const source: GpuSource = {
    label: "SIMULATED GPU source — no hardware queries",
    read: () => structuredClone(state),
    setEnabled: (enabled) => select(enabled ? "synthetic" : "disabled"),
  };
  return {
    source,
    select,
    mode: () => mode,
    reset: () => select(mode),
    observe: (frameId: number, hostFrame: number): GpuState => {
      if (mode !== "synthetic" || frameId < 0) {
        return source.read();
      }
      recentIds.push(frameId);
      if (recentIds.length > 3) {
        recentIds.shift();
      }
      const delayedId = recentIds[0];
      if (recentIds.length === 3 && delayedId !== undefined) {
        const cubesMs = 1.5 + Math.sin(hostFrame / 30) * 0.4;
        state = {
          status: "ready",
          currentRendererFrameId: hostFrame,
          droppedSamples: 0,
          sample: {
            frameId: delayedId,
            rendererFrameId: hostFrame - 2,
            measurement: "pass-sum",
            durationMs: cubesMs + 0.2,
            omittedPasses: 0,
            passes: [
              { label: "SIMULATED cubes", durationMs: cubesMs },
              { label: "SIMULATED grid", durationMs: 0.2 },
            ],
          },
        };
      }
      return source.read();
    },
  };
}

/** A small host-owned source: one synchronous reset followed by a measured elapsed wait. */
export function createLoadingExample() {
  let nextId = 1;
  let run: {
    id: number;
    startedAtMs: number;
    preparedAtMs: number;
    finishedAtMs: number | null;
  } | null = null;
  const completed: LoadingSnapshot[] = [];
  function snapshot(): LoadingSnapshot | null {
    if (!run) {
      return null;
    }
    const endMs = run.finishedAtMs ?? performance.now();
    return {
      id: run.id,
      label: "Host loading example",
      kind: "repeat-session",
      status: run.finishedAtMs === null ? "loading" : "ready",
      pendingOperations: run.finishedAtMs === null ? 1 : 0,
      elapsedMs: endMs - run.startedAtMs,
      stages: [
        { name: "reset cubes", durationMs: run.preparedAtMs - run.startedAtMs },
        { name: "host wait", durationMs: endMs - run.preparedAtMs },
      ].map((stage) => ({
        name: stage.name,
        totalMs: stage.durationMs,
        busyMs: stage.durationMs,
        operationCount: 1,
        failedCount: 0,
        cancelledCount: 0,
        receivedBytes: 0,
        cache: { hits: 0, misses: 0, inFlight: 0 },
      })),
    };
  }
  const source: LoadingSource = { snapshot, history: () => structuredClone(completed) };
  return {
    source,
    start: (prepare: () => void) => {
      const startedAtMs = performance.now();
      prepare();
      run = { id: nextId++, startedAtMs, preparedAtMs: performance.now(), finishedAtMs: null };
    },
    step: (atMs: number) => {
      if (run && run.finishedAtMs === null && atMs - run.preparedAtMs >= 200) {
        run.finishedAtMs = atMs;
        const finished = snapshot();
        if (finished) {
          completed.push(finished);
          if (completed.length > 10) {
            completed.shift();
          }
        }
      }
    },
  };
}

/** Converts profiler-relative timestamps into the browser's navigation-relative clock. */
export function createTraceExample(originMs: () => number) {
  const prefix = `jank-demo:${crypto.randomUUID().slice(0, 8)}:`;
  const retained: string[] = [];
  let sequence = 0;
  function remove(name: string): void {
    performance.clearMarks(name);
    performance.clearMeasures(name);
  }
  function keep(name: string): void {
    retained.push(name);
    const oldest = retained.length > 200 ? retained.shift() : undefined;
    if (oldest) {
      remove(oldest);
    }
  }
  const sink: TraceSink = {
    writeScope: (scope) => {
      const name = `${prefix}${sequence++}:${scope.channelId}`;
      performance.measure(name, {
        start: originMs() + scope.startedAtMs,
        end: originMs() + scope.endedAtMs,
      });
      keep(name);
    },
    writeEvent: (event) => {
      const name = `${prefix}${sequence++}:${event.label}`;
      performance.mark(name, { startTime: originMs() + event.atMs });
      keep(name);
    },
  };
  return {
    sink,
    count: () => retained.length,
    clear: () => {
      retained.forEach(remove);
      retained.length = 0;
    },
  };
}
