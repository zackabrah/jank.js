import type { GpuSource, GpuState, TraceSink } from "../../packages/jank/src/index.ts";

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
