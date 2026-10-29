import type { GpuProfile } from "../types/gpu-profile-types.ts";

const timerExtension = "EXT_disjoint_timer_query_webgl2";

/** Frames whose timer results are still outstanding before the oldest is dropped. */
const maxQueuedFrames = 64;

/** Timed passes per frame; later passes in the same frame are counted as omitted. */
const maxPassesPerFrame = 32;

const nanosecondsPerMs = 1e6;

const errorStatus = "error";

/**
 * The parts of a WebGL2 context the adapter uses. A WebGL2RenderingContext satisfies it, with
 * WebGLQuery as the query type.
 */
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

interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface QueuedFrame<Query> {
  frame: number;
  diagnosticFrame: number;
  passes: { label: string; query: Query }[];
  omitted: number;
}

/** True for the timer-query extension object, which carries the two enums the adapter needs. */
function isTimerExtension(value: unknown): value is TimerQueryExtension {
  return (
    typeof value === "object" &&
    value !== null &&
    "TIME_ELAPSED_EXT" in value &&
    typeof value.TIME_ELAPSED_EXT === "number" &&
    "GPU_DISJOINT_EXT" in value &&
    typeof value.GPU_DISJOINT_EXT === "number"
  );
}

/** Status before any timing has resolved: waiting for a sample, or switched off. */
function idleStatus(enabled: boolean): GpuProfile["status"] {
  return enabled ? "pending" : "disabled";
}

/**
 * GPU pass timings for a WebGL2 renderer, from `EXT_disjoint_timer_query_webgl2`. Where the
 * browser doesn't expose the extension the source says `unsupported`; it never estimates GPU
 * time from CPU timing. Results arrive a few frames late, linked to the frame that drew them.
 */
export function createWebGl2GpuSource<Query = WebGLQuery>(
  gl: WebGl2TimerContext<Query>,
  options: { onSample?: (profile: GpuProfile) => void } = {},
) {
  const extension = gl.getExtension(timerExtension);

  const timer = isTimerExtension(extension) ? extension : null;

  const queued: QueuedFrame<Query>[] = [];

  let enabled = timer !== null,
    disposed = false,
    frame = 0,
    dropped = 0,
    open: { label: string; query: Query } | null = null,
    current: QueuedFrame<Query>["passes"] = [],
    omitted = 0;

  let profile: GpuProfile = {
    available: timer !== null,
    enabled,
    status: timer ? idleStatus(enabled) : "unsupported",
    currentFrame: frame,
    sampleFrame: null,
    sampleAgeFrames: null,
    diagnosticFrame: null,
    gpuMilliseconds: null,
    passes: [],
    droppedFrames: 0,
    truncatedPasses: 0,
    error: null,
  };

  /** A copy of the profile with the current frame and sample age filled in. */
  const read = (): GpuProfile => ({
    ...profile,
    currentFrame: frame,
    sampleAgeFrames:
      profile.sampleFrame === null
        ? null
        : Math.max(0, frame - profile.sampleFrame),
    droppedFrames: dropped,
    passes: profile.passes.map((pass) => ({ ...pass })),
  });

  /** Ends an open query and deletes every query that hasn't been read, keeping GL state valid. */
  function discardAll() {
    if (open && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);

    if (open) gl.deleteQuery(open.query);

    for (const pass of current) gl.deleteQuery(pass.query);

    for (const entry of queued)
      for (const pass of entry.passes) gl.deleteQuery(pass.query);

    open = null;

    current = [];

    omitted = 0;

    queued.length = 0;
  }

  /** Reads finished frames, oldest first; a disjoint event voids every result read with it. */
  function collect() {
    if (!timer) return;

    while (
      queued.length &&
      queued[0]!.passes.every(
        (pass) =>
          gl.getQueryParameter(pass.query, gl.QUERY_RESULT_AVAILABLE) === true,
      )
    ) {
      const entry = queued.shift()!;

      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) === true;

      const passes = entry.passes.map((pass) => {
        const nanoseconds = gl.getQueryParameter(pass.query, gl.QUERY_RESULT);

        gl.deleteQuery(pass.query);

        return {
          label: pass.label,
          milliseconds:
            typeof nanoseconds === "number"
              ? nanoseconds / nanosecondsPerMs
              : null,
        };
      });

      // A disjoint event, such as a GPU power-state change, makes these results meaningless.
      if (disjoint) {
        dropped++;

        continue;
      }

      profile = {
        available: true,
        enabled,
        status: "ready",
        currentFrame: frame,
        sampleFrame: entry.frame,
        sampleAgeFrames: null,
        diagnosticFrame: entry.diagnosticFrame,
        // Timer queries time each pass; the gaps between passes aren't measured.
        gpuMilliseconds: null,
        passes,
        droppedFrames: dropped,
        truncatedPasses: entry.omitted,
        error: null,
      };

      options.onSample?.(read());
    }
  }

  return {
    label: "WebGL2 timer queries",
    read,
    /** Starts timing a named pass. Passes run one after another; WebGL2 can't nest timer queries. */
    beginPass(label: string) {
      if (disposed || !enabled || !timer) return;

      if (open)
        throw new Error(
          `End the "${open.label}" pass before beginning "${label}"`,
        );

      if (current.length >= maxPassesPerFrame) {
        omitted++;

        return;
      }

      const query = gl.createQuery();

      if (!query) return;

      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);

      open = { label, query };
    },
    /** Ends the pass begun last; does nothing when no pass is being timed. */
    endPass() {
      if (!open || !timer) return;

      gl.endQuery(timer.TIME_ELAPSED_EXT);

      current.push(open);

      open = null;
    },
    /** Closes the frame's passes, links them to a diagnostics frame and reads finished results. */
    captureFrame(diagnosticFrame: number) {
      if (disposed || !enabled || !timer) return;

      if (!Number.isSafeInteger(diagnosticFrame) || diagnosticFrame < 1)
        throw new RangeError("Frame IDs must be positive diagnostics IDs");

      if (open)
        throw new Error(
          `End the "${open.label}" pass before capturing the frame`,
        );

      frame++;

      // A lost context invalidates every query; report it and start again once restored.
      if (gl.isContextLost()) {
        discardAll();

        profile = {
          ...profile,
          status: errorStatus,
          error: "WebGL context lost",
        };

        return;
      }

      if (profile.status === errorStatus)
        profile = { ...profile, status: idleStatus(enabled), error: null };

      if (current.length)
        queued.push({ frame, diagnosticFrame, passes: current, omitted });

      current = [];

      omitted = 0;

      if (queued.length > maxQueuedFrames) {
        for (const pass of queued.shift()!.passes) gl.deleteQuery(pass.query);

        dropped++;
      }

      collect();
    },
    /** Starts or stops timing; stopping discards every result not yet read. */
    setEnabled(value: boolean) {
      if (disposed || !timer || enabled === value) return;

      discardAll();

      enabled = value;

      profile = {
        ...profile,
        enabled,
        status: idleStatus(enabled),
        sampleFrame: null,
        diagnosticFrame: null,
        passes: [],
        error: null,
      };
    },
    /** Stops timing and deletes the adapter's queries. The context stays the host's. */
    dispose() {
      if (disposed) return;

      discardAll();

      disposed = true;

      enabled = false;

      profile = {
        ...profile,
        enabled: false,
        status: timer ? "disabled" : "unsupported",
      };
    },
  };
}

export type WebGl2GpuSource = ReturnType<typeof createWebGl2GpuSource>;
