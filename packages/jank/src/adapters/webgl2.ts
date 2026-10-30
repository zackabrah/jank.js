import type { GpuState } from "../core/gpu.ts";
import { collectionLimits } from "../core/limits.ts";
import {
  type GpuAdapter,
  type GpuAdapterOptions,
  gpuError,
  readGpuState,
  validateFrameId,
} from "./gpu-adapter.ts";

const extensionName = "EXT_disjoint_timer_query_webgl2";
const maxPendingFrames = 64;
const maxPasses = 32;

/** Structural subset: native WebGL2 contexts satisfy this without a renderer dependency. */
export interface WebGl2TimerContext<Query = WebGLQuery> {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  readonly CURRENT_QUERY: number;
  getExtension(name: string): unknown;
  getParameter(parameter: number): unknown;
  getQuery(target: number, parameter: number): unknown;
  isContextLost(): boolean;
  createQuery(): Query | null;
  deleteQuery(query: Query | null): void;
  beginQuery(target: number, query: Query): void;
  endQuery(target: number): void;
  getQueryParameter(query: Query, parameter: number): unknown;
}

export interface WebGl2GpuSource extends GpuAdapter {
  /** Passes are sequential: WebGL cannot nest elapsed-time queries. */
  beginPass(label: string): void;
  endPass(): void;
}

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
interface Pass<Query> {
  readonly label: string;
  readonly query: Query;
}
interface PendingFrame<Query> {
  readonly frameId: number | null;
  readonly rendererFrameId: number;
  readonly passes: readonly Pass<Query>[];
  readonly omittedPasses: number;
}

function timerExtension(value: unknown): TimerExtension | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (!("TIME_ELAPSED_EXT" in value) || !("GPU_DISJOINT_EXT" in value)) {
    return null;
  }
  return typeof value.TIME_ELAPSED_EXT === "number" && typeof value.GPU_DISJOINT_EXT === "number"
    ? { TIME_ELAPSED_EXT: value.TIME_ELAPSED_EXT, GPU_DISJOINT_EXT: value.GPU_DISJOINT_EXT }
    : null;
}

/** Owns query allocation and nonblocking readback; never owns or schedules host rendering. */
export function createWebGl2GpuSource<Query = WebGLQuery>(
  gl: WebGl2TimerContext<Query>,
  options: GpuAdapterOptions = {},
): WebGl2GpuSource {
  let timer = timerExtension(gl.getExtension(extensionName));
  let enabled = options.enabled ?? true;
  let disposed = false;
  let lost = false;
  let rendererFrameId = 0;
  let droppedSamples = 0;
  let open: Pass<Query> | null = null;
  let current: Pass<Query>[] = [];
  let omittedPasses = 0;
  const pending: PendingFrame<Query>[] = [];
  let state: GpuState = idleState();

  function idleState(): GpuState {
    if (!timer) {
      return { status: "unsupported", reason: `${extensionName} is unavailable` };
    }
    return { status: enabled ? "pending" : "disabled" };
  }

  function deletePasses(passes: readonly Pass<Query>[]): void {
    for (const pass of passes) {
      gl.deleteQuery(pass.query);
    }
  }

  function discard(): number {
    const count = pending.length + (open || current.length > 0 ? 1 : 0);
    if (open) {
      if (
        timer &&
        !gl.isContextLost() &&
        gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === open.query
      ) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
      }
      gl.deleteQuery(open.query);
    }
    deletePasses(current);
    for (const frame of pending) {
      deletePasses(frame.passes);
    }
    open = null;
    current = [];
    pending.length = 0;
    omittedPasses = 0;
    return count;
  }

  function contextReady(): boolean {
    if (gl.isContextLost()) {
      droppedSamples += discard();
      lost = true;
      state = { status: "error", message: "WebGL context lost" };
      return false;
    }
    if (lost) {
      lost = false;
      timer = timerExtension(gl.getExtension(extensionName));
      state = idleState();
    }
    return timer !== null;
  }

  function fail(cause: unknown): void {
    droppedSamples += discard();
    state = gpuError(cause);
  }

  function beginPass(label: string): void {
    if (disposed || !enabled || !contextReady() || !timer) {
      return;
    }
    if (!label.trim() || label.length > collectionLimits.labelLength) {
      throw new RangeError("GPU pass labels must contain 1–240 characters");
    }
    if (open) {
      throw new Error(`End the "${open.label}" pass before beginning another pass`);
    }
    if (current.length >= maxPasses) {
      omittedPasses += 1;
      return;
    }
    openQuery(label, timer);
  }

  function openQuery(label: string, timer: TimerExtension): void {
    if (gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== null) {
      fail("Another elapsed-time query is active");
      return;
    }
    const query = gl.createQuery();
    if (query === null) {
      fail("Unable to allocate a GPU timer query");
      return;
    }
    open = { label, query };
    try {
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    } catch (cause) {
      fail(cause);
    }
  }

  function endPass(): void {
    if (disposed || !enabled || !contextReady() || !open || !timer) {
      return;
    }
    if (gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== open.query) {
      fail("The host replaced an active GPU timer query");
      return;
    }
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    current.push(open);
    open = null;
  }

  function discardDisjoint(): boolean {
    if (!timer || gl.getParameter(timer.GPU_DISJOINT_EXT) !== true) {
      return false;
    }
    droppedSamples += discard();
    state = { status: "pending" };
    return true;
  }

  function passResult(pass: Pass<Query>) {
    const nanoseconds = gl.getQueryParameter(pass.query, gl.QUERY_RESULT);
    if (typeof nanoseconds !== "number" || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
      throw new Error("Invalid GPU timer result");
    }
    return { label: pass.label, durationMs: nanoseconds / 1e6 };
  }

  function collect(): void {
    while (enabled && !disposed) {
      const frame = pending[0];
      if (
        !frame?.passes.every(
          (pass) => gl.getQueryParameter(pass.query, gl.QUERY_RESULT_AVAILABLE) === true,
        )
      ) {
        return;
      }
      const passes = frame.passes.map(passResult);
      if (discardDisjoint()) {
        return;
      }
      const sumMs = passes.reduce((sum, pass) => sum + pass.durationMs, 0);
      if (!Number.isFinite(sumMs)) {
        throw new Error("GPU pass sum exceeds the numeric range");
      }
      pending.shift();
      deletePasses(frame.passes);
      state = {
        status: "ready",
        currentRendererFrameId: rendererFrameId,
        droppedSamples,
        sample: {
          frameId: frame.frameId,
          rendererFrameId: frame.rendererFrameId,
          measurement: "pass-sum",
          durationMs: frame.omittedPasses === 0 ? sumMs : null,
          passes,
          omittedPasses: frame.omittedPasses,
        },
      };
      options.onSample?.(read());
    }
  }

  function enqueueFrame(frameId: number | null): void {
    if (current.length > 0) {
      pending.push({ frameId, rendererFrameId, passes: current, omittedPasses });
      if (state.status === "error") {
        state = { status: "pending" };
      }
    }
    current = [];
    omittedPasses = 0;
    if (pending.length > maxPendingFrames) {
      const expired = pending.shift();
      if (expired) {
        deletePasses(expired.passes);
        droppedSamples += 1;
      }
    }
  }

  function captureFrame(frameId: number | null): void {
    if (disposed || !enabled || !contextReady() || !timer) {
      return;
    }
    validateFrameId(frameId);
    if (open) {
      throw new Error(`End the "${open.label}" pass before capturing the frame`);
    }
    rendererFrameId += 1;
    try {
      if (discardDisjoint()) {
        return;
      }
      enqueueFrame(frameId);
      collect();
    } catch (cause) {
      fail(cause);
    }
  }

  function read(): GpuState {
    return readGpuState(state, rendererFrameId, droppedSamples);
  }

  return {
    label: "WebGL2 GPU pass timings",
    read,
    beginPass,
    endPass,
    captureFrame,
    setEnabled: (value) => {
      if (disposed || enabled === value) {
        return;
      }
      discard();
      enabled = value;
      state = idleState();
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      discard();
      disposed = true;
      enabled = false;
      state = idleState();
    },
  };
}
