import { describe, expect, it, vi } from "vitest";
import type { GpuState } from "./core/gpu.ts";
import { createProfiler, parseRecording, serializeRecording } from "./index.ts";
import type { ProfilerOptions } from "./profiler.ts";

function setup(options: ProfilerOptions = {}) {
  let timeMs = 100;
  const profiler = createProfiler({ ...options, now: () => timeMs });
  return {
    profiler,
    advanceTo: (atMs: number) => {
      timeMs = atMs;
    },
  };
}

function gpu(frameId: number): GpuState {
  return {
    status: "ready",
    currentRendererFrameId: 10,
    droppedSamples: 0,
    sample: {
      frameId,
      rendererFrameId: 8,
      measurement: "pass-sum",
      durationMs: 2,
      passes: [{ label: "opaque", durationMs: 2 }],
      omittedPasses: 0,
    },
  };
}

describe("public profiler recording path", () => {
  it("captures host scopes, counters, events and GPU data in a round-trippable file", () => {
    const { profiler, advanceTo } = setup({ application: { name: "Host", version: "1" } });
    const physics = profiler.createChannel({
      id: "physics",
      label: "Physics",
      readCounters: () => ({ bodies: 3 }),
    });
    profiler.capture.start();
    const frameId = profiler.beginFrame(100);
    advanceTo(102);
    const token = physics.begin();
    advanceTo(104);
    physics.end(token);
    profiler.endFrame({ updateMs: 2, renderMs: 3 });
    profiler.addEvent("Loaded", "First scene");
    profiler.observeGpu(gpu(frameId));
    advanceTo(116);
    profiler.beginFrame(116);
    const recording = profiler.capture.stop();
    expect(recording?.frames).toHaveLength(1);
    expect(recording?.frames[0]?.scopes).toEqual([
      { channelId: "physics", startedAtMs: 2, endedAtMs: 4 },
    ]);
    expect(recording?.counters[0]).toMatchObject({
      status: "ready",
      atMs: 0,
      channelId: "physics",
      values: { bodies: 3 },
    });
    expect(recording?.events).toEqual([{ atMs: 4, label: "Loaded", detail: "First scene" }]);
    expect(recording?.gpu[0]?.frameId).toBe(frameId);
    expect(recording?.metadata.application).toEqual({ name: "Host", version: "1" });
    expect(recording?.metadata.environment.timer.source).toBe("custom");
    if (!recording) {
      throw new Error("Missing capture");
    }
    expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
  });

  it("delivers each sealed frame once, including coarse repeated boundaries", () => {
    const { profiler, advanceTo } = setup();
    profiler.capture.start();
    profiler.beginFrame(100);
    profiler.beginFrame(100);
    advanceTo(116);
    profiler.beginFrame(116);
    profiler.beginFrame(116);
    advanceTo(132);
    profiler.beginFrame(132);
    expect(profiler.capture.stop()?.frames.map((frame) => frame.id)).toEqual([1, 2]);
  });

  it("runs automatic capture without a panel and preserves scope demand after it stops", () => {
    const { profiler, advanceTo } = setup();
    const channel = profiler.createChannel({ id: "work", label: "Work" });
    const release = profiler.requestScopes();
    profiler.capture.arm({ thresholdMs: 20, beforeFrames: 0, afterFrames: 0, cooldownMs: 0 });
    profiler.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    advanceTo(104);
    channel.end(token);
    advanceTo(125);
    profiler.beginFrame(125);
    expect(profiler.capture.completed()).toHaveLength(1);
    profiler.capture.disarm();
    advanceTo(141);
    profiler.beginFrame(141);
    advanceTo(143);
    const next = channel.begin();
    advanceTo(145);
    channel.end(next);
    advanceTo(157);
    profiler.beginFrame(157);
    expect(profiler.snapshot().frames.at(-1)?.scopes).toHaveLength(1);
    release();
  });

  it("clears observations, capture state and stale GPU links while keeping IDs monotonic", () => {
    const { profiler, advanceTo } = setup();
    profiler.capture.start();
    const oldId = profiler.beginFrame(100);
    profiler.addEvent("Old event");
    profiler.observeGpu(gpu(oldId));
    advanceTo(116);
    profiler.beginFrame(116);
    profiler.capture.stop();
    profiler.clear();
    expect(profiler.capture.completed()).toEqual([]);
    expect(profiler.snapshot()).toMatchObject({ frames: [], events: [], counters: [], gpu: null });
    advanceTo(132);
    expect(profiler.beginFrame(132)).toBeGreaterThan(oldId);
    profiler.observeGpu(gpu(oldId));
    expect(profiler.snapshot().gpu).toMatchObject({
      status: "ready",
      sample: { frameId: null, rendererFrameId: 8 },
    });
    advanceTo(148);
    profiler.beginFrame(148);
    expect(() => serializeRecording(profiler.capture.recent())).not.toThrow();
  });

  it("limits file observations to the selected window and detaches host-owned GPU objects", () => {
    const { profiler, advanceTo } = setup();
    profiler.addEvent("Before first frame");
    profiler.beginFrame(100);
    advanceTo(116);
    profiler.beginFrame(116);
    profiler.capture.start();
    advanceTo(118);
    profiler.addEvent("Inside");
    const sample = gpu(2);
    profiler.observeGpu(sample);
    if (sample.status === "ready") {
      Reflect.set(sample.sample.passes[0] ?? {}, "durationMs", 999);
    }
    advanceTo(132);
    profiler.beginFrame(132);
    profiler.addEvent("Pending frame");
    const saved = profiler.capture.stop();
    expect(saved?.events.map((event) => event.label)).toEqual(["Inside", "Pending frame"]);
    expect(saved?.gpu[0]?.passes[0]?.durationMs).toBe(2);
    if (!saved) {
      throw new Error("Missing capture");
    }
    expect(() => serializeRecording(saved)).not.toThrow();
  });
});

describe("bounded optional observations", () => {
  it("retains counter sampling rounds across all channels while live snapshots stay small", () => {
    const { profiler, advanceTo } = setup();
    for (let channel = 0; channel < 64; channel += 1) {
      profiler.createChannel({
        id: `channel-${channel}`,
        label: `Channel ${channel}`,
        readCounters: () => ({ value: channel }),
      });
    }
    profiler.capture.start();
    for (let round = 0; round <= 25; round += 1) {
      advanceTo(100 + round * 100);
      profiler.beginFrame(100 + round * 100);
    }
    expect(profiler.snapshot().counters).toHaveLength(64);
    const capture = profiler.capture.stop();
    expect(capture?.counters).toHaveLength(26 * 64);
    expect(capture?.counters[0]?.atMs).toBe(0);
    expect(capture?.truncated).toBe(false);
    if (!capture) {
      throw new Error("Missing capture");
    }
    expect(() => serializeRecording(capture)).not.toThrow();
  });

  it("bounds counter and GPU histories and reports losses in long captures", () => {
    const { profiler, advanceTo } = setup();
    profiler.createChannel({ id: "host", label: "Host", readCounters: () => ({ value: 1 }) });
    profiler.capture.start();
    for (let index = 0; index <= 1200; index += 1) {
      advanceTo(100 + index * 100);
      profiler.beginFrame(100 + index * 100);
    }
    expect(profiler.snapshot().counters).toHaveLength(1);
    const recording = profiler.capture.stop();
    expect(recording?.truncated).toBe(true);
    if (!recording) {
      throw new Error("Missing capture");
    }
    expect(() => serializeRecording(recording)).not.toThrow();
    const sample = gpu(1201);
    if (sample.status !== "ready") {
      throw new Error("Expected ready sample");
    }
    for (let index = 0; index <= 6000; index += 1) {
      profiler.observeGpu({
        ...sample,
        currentRendererFrameId: index,
        sample: { ...sample.sample, rendererFrameId: index },
      });
    }
    profiler.observeGpu({
      ...sample,
      currentRendererFrameId: 6000,
      sample: { ...sample.sample, rendererFrameId: 6000, durationMs: 7 },
    });
    advanceTo(120116);
    profiler.beginFrame(120116);
    const recent = profiler.capture.recent();
    expect(recent.gpu).toHaveLength(6000);
    expect(recent.gpu.at(-1)?.durationMs).toBe(7);
    expect(recent.truncated).toBe(true);
    expect(() => serializeRecording(recent)).not.toThrow();
  });

  it("defers replacement providers until the next poll and skips removed callbacks", () => {
    const { profiler, advanceTo } = setup();
    const replacementRead = vi.fn(() => ({ value: 2 }));
    const removedRead = vi.fn(() => ({ value: 3 }));
    const first = profiler.createChannel({
      id: "first",
      label: "First",
      readCounters: () => {
        first.dispose();
        second.dispose();
        profiler.createChannel({ id: "first", label: "First", readCounters: replacementRead });
        return { value: 1 };
      },
    });
    const second = profiler.createChannel({
      id: "second",
      label: "Second",
      readCounters: removedRead,
    });
    profiler.beginFrame(100);
    expect(profiler.snapshot().counters).toEqual([]);
    expect(removedRead).not.toHaveBeenCalled();
    expect(replacementRead).not.toHaveBeenCalled();
    advanceTo(200);
    profiler.beginFrame(200);
    expect(replacementRead).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale channel handle remove a replacement provider", () => {
    const { profiler, advanceTo } = setup();
    const description = { id: "host", label: "Host", readCounters: () => ({ value: 1 }) };
    const old = profiler.createChannel(description);
    profiler.beginFrame(100);
    old.dispose();
    const read = vi.fn(() => ({ value: 2, text: "" }));
    profiler.createChannel({ id: "host", label: "Host", readCounters: read });
    old.dispose();
    description.id = "changed";
    advanceTo(200);
    profiler.beginFrame(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(profiler.snapshot().counters.at(-1)).toMatchObject({
      status: "ready",
      values: { value: 2, text: "" },
    });
  });

  it("copies channel identity before the host can mutate its options", () => {
    const { profiler, advanceTo } = setup();
    const read = vi.fn(() => ({ value: 1 }));
    const options = { id: "host", label: "Host", readCounters: read };
    const channel = profiler.createChannel(options);
    profiler.beginFrame(100);
    options.id = "changed";
    channel.dispose();
    advanceTo(200);
    profiler.beginFrame(200);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(["clear", "dispose"] as const)(
    "does not resurrect observations when a provider calls %s",
    (action) => {
      const { profiler } = setup();
      profiler.createChannel({
        id: "host",
        label: "Host",
        readCounters: () => {
          profiler[action]();
          return { value: 1 };
        },
      });
      profiler.beginFrame(100);
      expect(profiler.snapshot()).toMatchObject({
        frames: [],
        counters: [],
        events: [],
        gpu: null,
      });
    },
  );

  it("samples counters at most every 100ms and reports provider errors explicitly", () => {
    const { profiler, advanceTo } = setup();
    const read = vi.fn(() => ({ value: 3 }));
    const channel = profiler.createChannel({ id: "host", label: "Host", readCounters: read });
    profiler.beginFrame(100);
    advanceTo(116);
    profiler.beginFrame(116);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockImplementation(() => {
      throw new Error("Provider offline");
    });
    advanceTo(200);
    profiler.beginFrame(200);
    expect(profiler.snapshot().counters.at(-1)).toMatchObject({
      status: "error",
      message: "Provider offline",
      atMs: 100,
    });
    advanceTo(216);
    profiler.beginFrame(216);
    expect(() => serializeRecording(profiler.capture.recent())).not.toThrow();
    channel.dispose();
    advanceTo(400);
    profiler.beginFrame(400);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("records invalid provider output as an error and bounds storage with truthful truncation", () => {
    const { profiler, advanceTo } = setup();
    profiler.createChannel({
      id: "host",
      label: "Host",
      readCounters: () => ({ value: Number.NaN }),
    });
    profiler.beginFrame(100);
    for (let index = 0; index < 220; index += 1) {
      profiler.addEvent(`event-${index}`);
    }
    expect(profiler.snapshot().events).toHaveLength(200);
    expect(profiler.snapshot().counters[0]).toMatchObject({ status: "error" });
    advanceTo(116);
    profiler.beginFrame(116);
    const recent = profiler.capture.recent();
    expect(recent.truncated).toBe(true);
    expect(recent.events[0]?.label).toBe("event-20");
    expect(() => serializeRecording(recent)).not.toThrow();
  });

  it("validates optional observations before replacing current GPU state", () => {
    const { profiler } = setup();
    profiler.beginFrame(100);
    profiler.observeGpu(gpu(1));
    const valid = profiler.snapshot().gpu;
    const bad = gpu(1);
    if (bad.status === "ready") {
      Reflect.set(bad.sample, "durationMs", -1);
    }
    expect(() => profiler.observeGpu(bad)).toThrow();
    expect(profiler.snapshot().gpu).toEqual(valid);
    expect(() => profiler.addEvent("")).toThrow();
    expect(() => profiler.addEvent("Valid", "x".repeat(2001))).toThrow();
    for (const state of [
      { status: "disabled" },
      { status: "pending" },
      { status: "unsupported", reason: "No timer" },
      { status: "error", message: "Lost device" },
    ] as const) {
      profiler.observeGpu(state);
      expect(profiler.snapshot().gpu).toEqual(state);
    }
  });
});

describe("trace ownership and disposal", () => {
  it("disables a failed event sink and preserves the original event", () => {
    const { profiler } = setup({
      trace: {
        writeScope: () => {},
        writeEvent: () => {
          throw new Error("");
        },
      },
    });
    profiler.setTraceEnabled(true);
    profiler.beginFrame(100);
    profiler.addEvent("Original");
    expect(profiler.snapshot().events).toEqual([
      { atMs: 0, label: "Original", detail: null },
      { atMs: 0, label: "Trace disabled", detail: "Provider failed" },
    ]);
    expect(profiler.capture.getState()).toEqual({ status: "idle" });
    expect(profiler.capture.getOptions().beforeFrames).toBe(120);
  });
  it("owns only its trace demand and never disposes the borrowed sink", () => {
    const trace = { writeScope: vi.fn(), writeEvent: vi.fn(), dispose: vi.fn() };
    const { profiler, advanceTo } = setup({ trace });
    const channel = profiler.createChannel({ id: "work", label: "Work" });
    profiler.setTraceEnabled(true);
    profiler.setTraceEnabled(true);
    profiler.beginFrame(100);
    advanceTo(102);
    const token = channel.begin();
    advanceTo(104);
    channel.end(token);
    profiler.addEvent("Marked");
    expect(trace.writeScope).toHaveBeenCalledWith({
      channelId: "work",
      startedAtMs: 2,
      endedAtMs: 4,
    });
    expect(trace.writeEvent).toHaveBeenCalledWith({ atMs: 4, label: "Marked" });
    profiler.setTraceEnabled(false);
    profiler.setTraceEnabled(false);
    advanceTo(116);
    profiler.beginFrame(116);
    channel.end(channel.begin());
    profiler.addEvent("Untraced");
    expect(trace.writeScope).toHaveBeenCalledTimes(1);
    expect(trace.writeEvent).toHaveBeenCalledTimes(1);
    profiler.dispose();
    profiler.dispose();
    expect(trace.dispose).not.toHaveBeenCalled();
  });

  it("turns a failed optional trace sink off and reports the failure without breaking the host", () => {
    const { profiler, advanceTo } = setup({
      trace: {
        writeScope: () => {
          throw new Error("Trace unavailable");
        },
        writeEvent: () => {},
      },
    });
    profiler.setTraceEnabled(true);
    const channel = profiler.createChannel({ id: "work", label: "Work" });
    profiler.beginFrame(100);
    const token = channel.begin();
    advanceTo(104);
    expect(() => channel.end(token)).not.toThrow();
    expect(profiler.snapshot().events.at(-1)).toMatchObject({
      label: "Trace disabled",
      detail: "Trace unavailable",
    });
    advanceTo(116);
    profiler.beginFrame(116);
    advanceTo(132);
    profiler.beginFrame(132);
    expect(profiler.snapshot().frames.at(-1)?.coverage.status).toBe("not-collected");
  });

  it("keeps disposed methods harmless and validates configuration at creation", () => {
    const { profiler } = setup();
    expect(() => profiler.setTraceEnabled(true)).toThrow(/sink/i);
    profiler.beginFrame(100);
    profiler.dispose();
    profiler.addEvent("Late");
    profiler.observeGpu(gpu(1));
    profiler.setTraceEnabled(true);
    profiler.capture.start();
    profiler.setTargetFps(120);
    expect(profiler.beginFrame(116)).toBe(-1);
    profiler.endFrame({ updateMs: 1, renderMs: 2 });
    expect(profiler.measureRefresh(() => 3)).toBe(3);
    expect(profiler.snapshot()).toMatchObject({ frames: [], counters: [], events: [], gpu: null });
    expect(() => setup({ application: { name: "" } })).toThrow();
  });
});

it.each(["absent", "available", "empty"] as const)(
  "resolves optional environment metadata when browser globals are %s",
  (kind) => {
    try {
      vi.stubGlobal(
        "navigator",
        kind === "absent"
          ? undefined
          : {
              userAgent: kind === "empty" ? "" : "Test browser",
              platform: kind === "empty" ? "" : "Test OS",
              hardwareConcurrency: kind === "empty" ? 0 : 4,
            },
      );
      vi.stubGlobal(
        "window",
        kind === "available"
          ? { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2 }
          : undefined,
      );
      vi.stubGlobal("crossOriginIsolated", kind === "available" ? true : undefined);
      const application = { name: "Host" };
      const profiler = createProfiler({ application });
      application.name = "Changed";
      const recording = profiler.capture.recent();
      expect(recording.metadata.application).toEqual({ name: "Host", version: null });
      expect(recording.metadata.environment.timer.source).toBe("performance.now");
      expect(recording.metadata.environment.viewport).toEqual(
        kind === "available" ? { widthPx: 800, heightPx: 600, pixelRatio: 2 } : null,
      );
      expect(() => serializeRecording(recording)).not.toThrow();
      profiler.dispose();
      expect(() => createProfiler().dispose()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
