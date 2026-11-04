import { type GpuFrame, type GpuInvocation, MAX_GPU_INVOCATIONS } from "./model.ts";

export interface WebGl2TimerContext<Query = WebGLQuery> {
  readonly QUERY_RESULT: number;
  readonly QUERY_RESULT_AVAILABLE: number;
  getExtension(name: string): unknown;
  getParameter(name: number): unknown;
  isContextLost(): boolean;
  createQuery(): Query | null;
  deleteQuery(query: Query | null): void;
  beginQuery(target: number, query: Query): void;
  endQuery(target: number): void;
  getQueryParameter(query: Query, name: number): unknown;
}

function extension(value: unknown) {
  return value &&
    typeof value === "object" &&
    "TIME_ELAPSED_EXT" in value &&
    typeof value.TIME_ELAPSED_EXT === "number" &&
    "GPU_DISJOINT_EXT" in value &&
    typeof value.GPU_DISJOINT_EXT === "number"
    ? { TIME_ELAPSED_EXT: value.TIME_ELAPSED_EXT, GPU_DISJOINT_EXT: value.GPU_DISJOINT_EXT }
    : null;
}

/** Owns elapsed queries exclusively. Host calls begin/end for every pass, then captureFrame. */
export function createWebGl2GpuSource<Query = WebGLQuery>(
  gl: WebGl2TimerContext<Query>,
  onFrame: (frame: GpuFrame) => void,
) {
  let timer = extension(gl.getExtension("EXT_disjoint_timer_query_webgl2"));
  let enabled = true;
  let disposed = false;
  let lost = false;
  let epoch = 0;
  let lastId = -1;
  let invocations: GpuInvocation[] = [];
  let omitted = 0;
  type QueryPass = { pass: GpuInvocation; query: Query };
  let queries: QueryPass[] = [];
  let open: QueryPass | null = null;
  let inPass = false;
  const queued: { frame: GpuFrame; queries: QueryPass[] }[] = [];
  const emit = (frame: GpuFrame) => onFrame(structuredClone(frame));
  const reject = (items: QueryPass[], reason: string) => {
    for (const { pass, query } of items) {
      gl.deleteQuery(query);
      pass.state = "rejected";
      pass.reason = reason;
    }
  };
  const invalidate = (reason: string) => {
    if (open && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
    open = null;
    reject(queries, reason);
    queries = [];
    for (const entry of queued.splice(0)) {
      reject(entry.queries, reason);
      emit(entry.frame);
    }
  };
  const poll = () => {
    if (disposed) return;
    if (gl.isContextLost()) {
      if (!lost) invalidate("WebGL context lost");
      lost = true;
      return;
    }
    if (lost) {
      lost = false;
      epoch++;
      timer = extension(gl.getExtension("EXT_disjoint_timer_query_webgl2"));
    }
    if (!timer) return;
    // Reading this flag clears its history: one check invalidates the entire outstanding batch.
    if (gl.getParameter(timer.GPU_DISJOINT_EXT) === true) {
      invalidate("GPU timer disjoint event");
      return;
    }
    for (let i = queued.length - 1; i >= 0; i--) {
      const entry = queued[i];
      if (
        !entry?.queries.every(
          ({ query }) => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true,
        )
      )
        continue;
      for (const { query, pass } of entry.queries) {
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
        gl.deleteQuery(query);
        if (typeof ns === "number" && Number.isFinite(ns) && ns >= 0) {
          pass.state = "timed";
          pass.milliseconds = ns / 1e6;
        } else {
          pass.state = "rejected";
          pass.reason = "Invalid GPU elapsed result";
        }
      }
      queued.splice(i, 1);
      emit(entry.frame);
    }
  };
  return {
    poll,
    get supported() {
      return timer !== null;
    },
    get enabled() {
      return enabled && !disposed;
    },
    beginPass(label: string) {
      if (disposed) throw new Error("GPU source is disposed.");
      if (lost && !gl.isContextLost()) poll();
      if (inPass) throw new Error("WebGL elapsed queries cannot nest; end the current pass first.");
      if (!label || label.length > 240)
        throw new Error("GPU pass labels must be 1–240 characters.");
      inPass = true;
      if (invocations.length >= MAX_GPU_INVOCATIONS) {
        omitted++;
        return;
      }
      const pass: GpuInvocation = {
        id: String(invocations.length),
        label,
        kind: "render",
        state: "pending",
        milliseconds: null,
        startMs: null,
        endMs: null,
        reason: null,
      };
      invocations.push(pass);
      const reason = !timer
        ? "GPU timer queries unsupported"
        : !enabled
          ? "GPU timing disabled"
          : gl.isContextLost()
            ? "WebGL context lost"
            : queries.length >= 32
              ? "GPU query capacity reached"
              : null;
      const query = reason ? null : gl.createQuery();
      if (!query || !timer) {
        pass.state = "omitted";
        pass.reason = reason ?? "GPU query allocation failed";
        return;
      }
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      open = { pass, query };
      queries.push(open);
    },
    endPass() {
      if (!inPass) throw new Error("No GPU pass is open.");
      if (open && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
      open = null;
      inPass = false;
    },
    captureFrame(frameId: number, inventory: GpuFrame["inventory"] = "unknown") {
      if (disposed) throw new Error("GPU source is disposed.");
      if (inPass) throw new Error("End the GPU pass before sealing the frame.");
      if (!Number.isSafeInteger(frameId) || frameId <= lastId)
        throw new Error("GPU frame IDs must increase.");
      lastId = frameId;
      const frame: GpuFrame = {
        frameId,
        source: "webgl2",
        clock: "gpu",
        epoch,
        resolutionMs: null,
        inventory,
        invocations,
        omitted,
      };
      queued.push({ frame, queries });
      invocations = [];
      queries = [];
      omitted = 0;
      emit(frame);
      if (queued.length > 64) {
        const oldest = queued.shift();
        if (oldest) {
          reject(oldest.queries, "GPU readback queue capacity reached");
          emit(oldest.frame);
        }
      }
      poll();
    },
    setEnabled(value: boolean) {
      if (disposed || enabled === value) return;
      invalidate("GPU timing changed while readback was pending");
      enabled = value;
    },
    dispose() {
      if (disposed) return;
      invalidate("GPU timing source disposed");
      disposed = true;
    },
  };
}
