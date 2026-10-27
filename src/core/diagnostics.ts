import { estimateTimerResolution, recordingMetadata } from "./environment.ts";

import { createDevToolsSink, type DiagnosticTraceSink } from "./devtools.ts";

import { intervalUnion } from "./inspection.ts";

import type { GpuProfile } from "../types/gpu-profile-types.ts";

import type {
  AutoCaptureOptions,
  CaptureStatus,
  DiagnosticFrame,
  DiagnosticOverhead,
  DiagnosticScope,
  DiagnosticSnapshot,
  DiagnosticSystem,
  DiagnosticValues,
  DiagnosticEvent,
  FrameBudget,
  PerformanceRecording,
} from "./recording-types.ts";

export type {
  DiagnosticFrame,
  DiagnosticSnapshot,
  DiagnosticValues,
  DiagnosticEvent,
} from "./recording-types.ts";

export interface DiagnosticChannel {
  begin(): number;

  end(token: number): void;

  dispose(): void;
}

export interface DiagnosticsOptions {
  now?: () => number;
  costClock?: () => number;
  application?: { name: string; version?: string };
  targetFps?: number;
  devTools?: boolean | DiagnosticTraceSink;
  maxScopesPerFrame?: number;
}

export interface Diagnostics {
  readonly detailed: boolean;
  readonly recording: boolean;
  /** Close the preceding interval and open a new one. Returns its stable frame ID. */
  beginFrame(at: number): number;

  /** Attach CPU durations to the current explicit frame. Closing is deferred to the next boundary. */
  endFrame(updateMs: number, renderMs: number): void;

  /** Compatibility sampler. Scope attribution is unavailable; prefer beginFrame/endFrame. */
  frame(at: number, interval: number, update: number, render: number): void;

  setExpanded(value: boolean): void;

  setTargetFps(value: number): void;

  setDevToolsEnabled(value: boolean): void;

  armCapture(options?: AutoCaptureOptions): void;

  disarmCapture(): void;

  register(
    id: string,
    label: string,
    read?: () => DiagnosticValues,
  ): DiagnosticChannel;

  event(label: string, detail?: string): void;

  /** Measure synchronous view work, subtracting collection already measured inside it. */
  measureRefresh<T>(work: () => T): T;

  /** Report an exclusive refresh cost, without collection time. */
  recordOverhead(kind: "refresh", milliseconds: number): void;

  observeGpu(profile: GpuProfile): void;

  snapshot(includeSystems?: boolean): DiagnosticSnapshot;

  startRecording(): void;

  stopRecording(): void;

  clear(): void;

  export(): PerformanceRecording;

  dispose(): void;
}

class History<T> {
  private readonly items: (T | undefined)[];
  private cursor = 0;
  private count = 0;
  private readonly capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;

    this.items = Array.from({ length: capacity });
  }
  get length() {
    return this.count;
  }
  push(value: T) {
    this.items[this.cursor] = value;

    this.cursor = (this.cursor + 1) % this.capacity;

    this.count = Math.min(this.count + 1, this.capacity);
  }
  clear() {
    this.items.fill(undefined);

    this.cursor = this.count = 0;
  }
  read(): T[] {
    return Array.from(
      { length: this.count },
      (_, i) =>
        this.items[
          (this.cursor - this.count + i + this.capacity) % this.capacity
        ]!,
    );
  }
}

interface Channel {
  id: string;
  label: string;
  read: (() => DiagnosticValues) | undefined;
  total: number;
  samples: number;
  peak: number;
  current: number;
}

interface OpenScope {
  channel: Channel;
  start: number;
}

const overheadDescription =
  "Synchronous instrumentation and UI refresh; excludes deferred browser layout, paint and GPU work" as const;

const finiteDuration = (value: number) => Number.isFinite(value) && value >= 0;

// The schema contains primitives and these two nested collections. Copy them
// explicitly so a live view stays detached without serializing 600 frame objects.
const copyFrame = (frame: DiagnosticFrame): DiagnosticFrame => ({
  ...frame,
  scopes: frame.scopes.map((scope) => ({ ...scope })),
  overhead: { ...frame.overhead },
});

export function createDiagnostics(
  input: DiagnosticsOptions | (() => number) = {},
): Diagnostics {
  const options: DiagnosticsOptions =
    typeof input === "function" ? { now: input } : input;

  const now = options.now ?? (() => performance.now());

  const costClock = options.costClock ?? (() => performance.now());

  const timer = estimateTimerResolution(now);

  timer.source = options.now ? "custom" : "performance.now";

  const trace =
    typeof options.devTools === "object"
      ? options.devTools
      : createDevToolsSink({ enabled: options.devTools ?? false });

  const ownsTrace = typeof options.devTools !== "object";

  const application = options.application
    ? {
        name: options.application.name.slice(0, 240),
        version: options.application.version?.slice(0, 240) ?? null,
      }
    : null;

  let metadata = recordingMetadata(timer, application, trace.enabled);

  let budget: FrameBudget = { targetFps: 60, frameMs: 1000 / 60 };

  const scopeLimit = options.maxScopesPerFrame ?? 128;

  if (!Number.isInteger(scopeLimit) || scopeLimit < 1 || scopeLimit > 1024)
    throw new RangeError("Scope capacity must be 1–1024");

  const history = new History<DiagnosticFrame>(600),
    recorded = new History<DiagnosticFrame>(6000);

  const channels = new Map<string, Channel>(),
    open = new Map<number, OpenScope>();

  const gpu = new History<GpuProfile>(6000);

  let latestGpu: GpuProfile | null = null,
    lastGpuFrame = -1;

  const events: DiagnosticEvent[] = [],
    samples: PerformanceRecording["samples"] = [];

  let expanded = false,
    recording = false,
    disposed = false,
    origin = now(),
    lastSample = -Infinity;

  let nextFrame = 0,
    token = 0,
    pending:
      | {
          id: number;
          start: number;
          update: number;
          render: number;
          detailed: boolean;
        }
      | undefined;

  let ended: DiagnosticScope[] = [],
    droppedScopes = 0,
    collectionMs = 0,
    totalCollectionMs = 0,
    refreshMs = 0;

  let armed = false,
    autoRemaining = 0,
    nextAllowed = -Infinity;

  let capture: CaptureStatus = {
    mode: "recent",
    state: "idle",
    triggerFrame: null,
    thresholdMs: null,
    beforeFrames: 120,
    afterFrames: 120,
    cooldownMs: 5000,
    remainingFrames: 0,
  };

  const collectCost = (start: number) => {
    const duration = Math.max(0, costClock() - start);

    collectionMs += duration;

    totalCollectionMs += duration;
  };

  const event = (label: string, detail = "") => {
    if (disposed) return;

    const at = now();

    events.push({
      at: at - origin,
      label: label.slice(0, 240),
      detail: detail.slice(0, 2000),
    });

    if (events.length > 200) events.shift();

    trace.marker(label.slice(0, 240), detail.slice(0, 2000), at);
  };

  const systems = (): DiagnosticSystem[] =>
    [...channels.values()].map((channel) => {
      let values: DiagnosticValues = {};

      try {
        const entries = Object.entries(channel.read?.() ?? {}).slice(0, 64);

        values = Object.fromEntries(
          entries.map(([key, value]) => [
            key.slice(0, 240),
            typeof value === "number"
              ? Number.isFinite(value)
                ? value
                : null
              : typeof value === "string"
                ? value.slice(0, 2000)
                : typeof value === "boolean"
                  ? value
                  : null,
          ]),
        );
      } catch {
        values = { error: "Diagnostic provider unavailable" };
      }

      return {
        id: channel.id,
        label: channel.label,
        cpu: channel.samples ? channel.total / channel.samples : 0,
        peak: channel.peak,
        values,
      };
    });

  const overhead = (frames = history.read()): DiagnosticOverhead => {
    const summarize = (key: "collectionMs" | "refreshMs") => ({
      last: frames.at(-1)?.overhead[key] ?? 0,
      mean: frames.length
        ? frames.reduce((sum, frame) => sum + frame.overhead[key], 0) /
          frames.length
        : 0,
      peak: frames.reduce(
        (peak, frame) => Math.max(peak, frame.overhead[key]),
        0,
      ),
    });

    return {
      collection: summarize("collectionMs"),
      refresh: summarize("refreshMs"),
      frames: frames.length,
      measurement: overheadDescription,
    };
  };

  function finishRecording(at: number) {
    recording = false;

    capture.remainingFrames = 0;

    nextAllowed = at + capture.cooldownMs;

    capture.state = armed ? "cooldown" : "idle";

    event(
      "Recording complete",
      capture.mode === "automatic"
        ? "Spike window captured"
        : "6000-frame limit reached",
    );
  }

  function commit(frame: DiagnosticFrame) {
    history.push(frame);

    const absolute = frame.at + origin;

    if (!recording && armed && absolute >= nextAllowed) {
      capture.state = "armed";

      if (frame.interval > (capture.thresholdMs ?? budget.frameMs * 2)) {
        recorded.clear();

        samples.length = 0;

        for (const previous of history
          .read()
          .slice(-(capture.beforeFrames + 1)))
          recorded.push(previous);

        metadata = recordingMetadata(timer, application, trace.enabled);

        capture.mode = "automatic";

        capture.state = "recording";

        capture.triggerFrame = frame.id;

        autoRemaining = capture.afterFrames;

        capture.remainingFrames = autoRemaining;

        recording = true;

        lastSample = -Infinity;

        event(
          "Spike captured",
          `Frame ${frame.id}: ${frame.interval.toFixed(2)} ms`,
        );

        if (autoRemaining === 0) finishRecording(absolute);
      }
    } else if (recording) {
      recorded.push(frame);

      if (capture.mode === "automatic") {
        capture.remainingFrames = --autoRemaining;

        if (autoRemaining <= 0) finishRecording(absolute);
      }

      if (recorded.length === 6000 && recording) finishRecording(absolute);
    }

    if (recording && absolute - lastSample >= 250) {
      samples.push({ at: frame.at, systems: systems() });

      if (samples.length > 1200) samples.shift();

      lastSample = absolute;
    }
  }

  function seal(at: number) {
    if (!pending) return;

    const start = pending.start;

    const scopes: DiagnosticScope[] = [];

    const add = (scope: DiagnosticScope) => {
      const a = Math.max(start - origin, scope.start),
        b = Math.min(at - origin, scope.end);

      if (b <= a) return;

      if (scopes.length < scopeLimit)
        scopes.push({ ...scope, start: a, end: b });
      else droppedScopes++;
    };

    for (const scope of ended) add(scope);

    for (const scope of open.values())
      add({
        system: scope.channel.id,
        label: scope.channel.label,
        start: scope.start - origin,
        end: at - origin,
      });

    for (const channel of channels.values()) {
      if (pending.detailed) {
        const duration = intervalUnion(
          scopes.filter((scope) => scope.system === channel.id),
        );

        channel.total += duration;

        channel.samples++;

        channel.peak = Math.max(channel.peak, duration);
      }

      channel.current = 0;
    }

    const frame: DiagnosticFrame = {
      id: pending.id,
      at: at - origin,
      interval: at - start,
      update: pending.update,
      render: pending.render,
      scopes,
      coverage: !pending.detailed
        ? "unavailable"
        : droppedScopes
          ? "truncated"
          : "complete",
      droppedScopes,
      overhead: { collectionMs, refreshMs },
    };

    // An animation callback's timestamp can precede work that has already
    // finished by the time the callback runs. Preserve that scope's tail for
    // the next measurable interval instead of silently discarding it.
    ended = ended.filter((scope) => scope.end > at - origin);

    droppedScopes = 0;

    collectionMs = refreshMs = 0;

    commit(frame);
  }

  const api: Diagnostics = {
    get detailed() {
      return !disposed && (expanded || recording || armed || trace.enabled);
    },
    get recording() {
      return recording;
    },
    beginFrame(at) {
      if (disposed) return -1;

      if (!Number.isFinite(at) || (pending && at < pending.start))
        throw new RangeError(
          `Frame boundaries must increase on the diagnostics clock (${at} < ${pending?.start ?? "unset"})`,
        );

      const cost = costClock();

      // Coarsened browser timestamps can repeat. Keep one measurable interval
      // and accumulate its CPU work rather than throwing or inventing duration.
      if (pending && at === pending.start) {
        collectCost(cost);

        return pending.id;
      }

      if (pending) seal(at);
      else {
        ended = [];

        droppedScopes = 0;

        collectionMs = refreshMs = 0;
      }

      pending = {
        id: ++nextFrame,
        start: at,
        update: 0,
        render: 0,
        detailed: api.detailed,
      };

      collectCost(cost);

      return pending.id;
    },
    endFrame(update, render) {
      if (disposed || !pending) return;

      const cost = costClock();

      if (finiteDuration(update) && finiteDuration(render)) {
        pending.update += update;

        pending.render += render;
      }

      collectCost(cost);
    },
    frame(at, interval, update, render) {
      if (disposed) return;

      if (pending)
        throw new Error("Do not mix frame() with beginFrame()/endFrame()");

      const cost = costClock();

      if (
        [at, interval, update, render].every(Number.isFinite) &&
        interval > 0 &&
        update >= 0 &&
        render >= 0
      ) {
        for (const channel of channels.values()) {
          if (api.detailed) {
            channel.total += channel.current;

            channel.samples++;

            channel.peak = Math.max(channel.peak, channel.current);
          }

          channel.current = 0;
        }

        commit({
          id: ++nextFrame,
          at: at - origin,
          interval,
          update,
          render,
          scopes: [],
          coverage: "unavailable",
          droppedScopes: 0,
          overhead: { collectionMs, refreshMs },
        });

        collectionMs = refreshMs = 0;
      }

      ended = [];

      droppedScopes = 0;

      collectCost(cost);
    },
    setExpanded(value) {
      expanded = value;

      if (pending && !api.detailed) pending.detailed = false;
    },
    setTargetFps(value) {
      if (!Number.isFinite(value) || value < 1 || value > 1000)
        throw new RangeError("Target FPS must be between 1 and 1000");

      budget = { targetFps: value, frameMs: 1000 / value };
    },
    setDevToolsEnabled(value) {
      trace.setEnabled(value);

      metadata.devTools ||= trace.enabled;

      if (pending && !api.detailed) pending.detailed = false;
    },
    armCapture(settings = {}) {
      const thresholdMs = settings.thresholdMs ?? budget.frameMs * 2,
        beforeFrames = settings.beforeFrames ?? 120,
        afterFrames = settings.afterFrames ?? 120,
        cooldownMs = settings.cooldownMs ?? 5000;

      if (
        !Number.isFinite(thresholdMs) ||
        thresholdMs <= 0 ||
        !Number.isInteger(beforeFrames) ||
        beforeFrames < 0 ||
        beforeFrames > 599 ||
        !Number.isInteger(afterFrames) ||
        afterFrames < 0 ||
        afterFrames > 5400 ||
        !Number.isFinite(cooldownMs) ||
        cooldownMs < 0
      )
        throw new RangeError("Invalid spike capture window or threshold");

      if (disposed) return;

      armed = true;

      capture = {
        mode: "recent",
        state: "armed",
        triggerFrame: null,
        thresholdMs,
        beforeFrames,
        afterFrames,
        cooldownMs,
        remainingFrames: 0,
      };

      if (recording) api.stopRecording();

      nextAllowed = -Infinity;
    },
    disarmCapture() {
      armed = false;

      if (pending && !api.detailed) pending.detailed = false;

      if (!recording) capture.state = "idle";
    },
    register(id, label, read) {
      if (!id.trim() || id.length > 240 || !label.trim() || label.length > 240)
        throw new Error("System IDs and labels must be 1–240 characters");

      if (channels.has(id)) throw new Error(`System already registered: ${id}`);

      if (channels.size >= 64)
        throw new RangeError("At most 64 diagnostic systems may be registered");

      const channel: Channel = {
        id,
        label,
        read,
        total: 0,
        samples: 0,
        peak: 0,
        current: 0,
      };

      let active = !disposed;

      if (active) channels.set(id, channel);

      return {
        begin() {
          if (!active || !api.detailed) return -1;

          const cost = costClock();

          if (open.size >= scopeLimit) {
            droppedScopes++;

            collectCost(cost);

            return -1;
          }

          const handle = ++token;

          open.set(handle, { channel, start: now() });

          collectCost(cost);

          return handle;
        },
        end(handle) {
          if (!active || disposed || handle < 0) return;

          const cost = costClock(),
            scope = open.get(handle);

          if (scope?.channel !== channel) {
            collectCost(cost);

            return;
          }

          open.delete(handle);

          const end = now();

          if (Number.isFinite(end) && end >= scope.start) {
            channel.current += end - scope.start;

            if (ended.length < scopeLimit)
              ended.push({
                system: id,
                label,
                start: scope.start - origin,
                end: end - origin,
              });
            else droppedScopes++;

            trace.scope(id, label, scope.start, end);
          }

          collectCost(cost);
        },
        dispose() {
          if (!active) return;

          active = false;

          channels.delete(id);

          for (const [handle, scope] of open)
            if (scope.channel === channel) {
              open.delete(handle);

              droppedScopes++;
            }
        },
      };
    },
    event,
    measureRefresh(work) {
      const start = costClock(),
        collected = totalCollectionMs;

      try {
        return work();
      } finally {
        if (!disposed)
          refreshMs += Math.max(
            0,
            costClock() - start - (totalCollectionMs - collected),
          );
      }
    },
    recordOverhead(_kind, milliseconds) {
      if (!disposed && finiteDuration(milliseconds)) refreshMs += milliseconds;
    },
    observeGpu(profile) {
      if (disposed) return;

      const cost = costClock();

      latestGpu = structuredClone(profile);

      if (profile.available) metadata.environment.gpuTimer.source = "host";

      if (
        profile.status !== "ready" ||
        profile.sampleFrame === null ||
        profile.sampleFrame <= lastGpuFrame
      ) {
        collectCost(cost);

        return;
      }

      lastGpuFrame = profile.sampleFrame;

      gpu.push(structuredClone(profile));

      collectCost(cost);
    },
    snapshot(includeSystems = true) {
      const cost = costClock();

      const frames = history.read();

      const result: DiagnosticSnapshot = {
        frames: frames.map(copyFrame),
        systems: includeSystems ? systems() : [],
        events: events.map((entry) => ({ ...entry })),
        recording,
        recordedFrames: recorded.length,
        budget: { ...budget },
        capture: { ...capture },
        overhead: overhead(frames),
      };

      collectCost(cost);

      return result;
    },
    startRecording() {
      if (disposed) return;

      recorded.clear();

      samples.length = 0;

      recording = true;

      lastSample = -Infinity;

      capture.mode = "manual";

      capture.state = "recording";

      capture.triggerFrame = null;

      capture.remainingFrames = 0;

      metadata = recordingMetadata(timer, application, trace.enabled);

      event("Recording started");
    },
    stopRecording() {
      if (recording) event("Recording stopped");

      recording = false;

      capture.remainingFrames = 0;

      nextAllowed = now() + capture.cooldownMs;

      capture.state = armed ? "cooldown" : "idle";

      if (pending && !api.detailed) pending.detailed = false;
    },
    clear() {
      history.clear();

      recorded.clear();

      gpu.clear();

      latestGpu = null;

      lastGpuFrame = -1;

      samples.length = events.length = 0;

      ended = [];

      open.clear();

      pending = undefined;

      droppedScopes = 0;

      collectionMs = refreshMs = 0;

      origin = now();

      lastSample = -Infinity;

      recording = false;

      capture.mode = "recent";

      capture.state = armed ? "armed" : "idle";

      capture.triggerFrame = null;

      capture.remainingFrames = 0;

      nextAllowed = -Infinity;

      metadata = recordingMetadata(timer, application, trace.enabled);

      for (const channel of channels.values())
        channel.total = channel.samples = channel.peak = channel.current = 0;
    },
    export() {
      const cost = costClock(),
        frames = recorded.length ? recorded.read() : history.read();

      const ids = new Set(frames.map((frame) => frame.id));

      const result: PerformanceRecording = structuredClone({
        format: "jank.js-recording",
        version: 2,
        units: "milliseconds",
        frameCapacity: 6000,
        metadata,
        budget,
        capture,
        overhead: overhead(frames.slice(-600)),
        frames,
        samples,
        events,
        systems: systems(),
        ...(latestGpu
          ? {
              gpu: {
                units: "milliseconds",
                measurement:
                  "Asynchronous GPU timings; diagnosticFrame explicitly links frames when supplied",
                latest: latestGpu,
                samples: gpu
                  .read()
                  .filter(
                    (profile) =>
                      profile.diagnosticFrame == null ||
                      ids.has(profile.diagnosticFrame),
                  ),
              },
            }
          : {}),
      });

      collectCost(cost);

      return result;
    },
    dispose() {
      disposed = true;

      recording = false;

      armed = false;

      open.clear();

      channels.clear();

      history.clear();

      recorded.clear();

      gpu.clear();

      pending = undefined;

      ended = [];

      samples.length = events.length = 0;

      if (ownsTrace) trace.dispose();
    },
  };

  api.setTargetFps(options.targetFps ?? 60);

  return api;
}
