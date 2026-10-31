import { describe, expect, it } from "vitest";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import type { FrameSample } from "../core/frames.ts";
import { serializeRecording } from "./codec.ts";
import { createCaptureController } from "./controller.ts";

const options = { thresholdMs: 20, beforeFrames: 2, afterFrames: 2, cooldownMs: 100 };

function setup() {
  const recent: FrameSample[] = [];
  let nextId = 0;
  let timeMs = 0;
  let demands = 0;
  let failExport = false;
  const controller = createCaptureController({
    frameBudgetMs: () => 1000 / 60,
    gpuCoverage: (frames) => summarizeGpuCoverage({ frames, gpu: [] }),
    recentFrames: () => recent,
    requestScopes: () => {
      demands += 1;
      return () => {
        demands -= 1;
      };
    },
    createRecording: (frames, capture, truncated) => {
      if (failExport) {
        throw new Error("Export failed");
      }
      return {
        ...recordingFixture(),
        frames,
        capture,
        truncated,
        channels: [],
        counters: [],
        events: [],
        gpu: [],
      };
    },
  });
  function frame(durationMs = 16): FrameSample {
    nextId += 1;
    const sample: FrameSample = {
      id: nextId,
      startedAtMs: timeMs,
      endedAtMs: timeMs + durationMs,
      cpu: { updateMs: null, renderMs: null },
      scopes: [],
      coverage: { status: "not-collected" },
      overhead: { collectionMs: 0, refreshMs: 0 },
    };
    timeMs += durationMs;
    recent.push(sample);
    if (recent.length > 600) {
      recent.shift();
    }
    controller.accept(sample);
    return sample;
  }
  return {
    controller,
    frame,
    demands: () => demands,
    failExport: (value: boolean) => {
      failExport = value;
    },
  };
}

describe("manual capture", () => {
  it("reports active capacity and sealed-frame GPU coverage through clear and disposal", () => {
    const { controller, frame } = setup();
    expect(controller.getProgress()).toMatchObject({
      kind: "recent",
      frameCount: 0,
      remainingFrames: 600,
    });
    controller.start();
    frame();
    expect(controller.getProgress()).toMatchObject({
      kind: "manual",
      frameCount: 1,
      remainingFrames: 5999,
      gpu: { totalFrames: 1, missingFrames: 1, coveragePercent: 0 },
    });
    controller.stop();
    controller.arm(options);
    frame(40);
    expect(controller.getProgress()).toMatchObject({ kind: "automatic", remainingFrames: 2 });
    controller.clear();
    expect(controller.getProgress().kind).toBe("recent");
    controller.dispose();
    expect(controller.getProgress()).toMatchObject({
      frameCount: 0,
      gpu: { coveragePercent: null },
    });
  });
  it("records only accepted sealed frames and stops without manufacturing a final frame", () => {
    const { controller, frame, demands } = setup();
    frame();
    expect(controller.stop()).toBeNull();
    controller.start();
    controller.start();
    expect(demands()).toBe(1);
    const first = frame();
    const second = frame();
    expect(controller.getState()).toEqual({ status: "manual", recordedFrames: 2 });
    const recording = controller.stop();
    expect(recording?.frames).toEqual([first, second]);
    expect(recording?.capture).toEqual({ kind: "manual" });
    expect(recording?.truncated).toBe(false);
    expect(demands()).toBe(0);
    expect(controller.getState()).toEqual({ status: "idle" });
    expect(controller.completed()).toEqual([recording]);
  });

  it("archives an empty manual capture and keeps only ten completed captures", () => {
    const { controller, frame } = setup();
    controller.start();
    expect(controller.stop()?.frames).toEqual([]);
    for (let index = 0; index < 12; index += 1) {
      controller.start();
      frame();
      controller.stop();
    }
    expect(controller.completed()).toHaveLength(10);
    expect(controller.completed()[0]?.frames[0]?.id).toBe(3);
    expect(controller.list().map((capture) => capture.id)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(controller.read(3)).toBeNull();
    expect(controller.read(4)?.frames[0]?.id).toBe(3);
  });

  it("caps manual recording at 6000 frames and releases only its scope request", () => {
    const { controller, frame, demands } = setup();
    controller.start();
    for (let index = 0; index < 6001; index += 1) {
      frame();
    }
    expect(controller.getState()).toEqual({ status: "idle" });
    expect(controller.completed()[0]?.frames).toHaveLength(6000);
    expect(controller.completed()[0]?.truncated).toBe(true);
    expect(demands()).toBe(0);
    expect(controller.recent().frames).toHaveLength(600);
  });

  it("retains the active recording when assembly fails", () => {
    const { controller, frame, failExport, demands } = setup();
    controller.start();
    frame();
    failExport(true);
    expect(() => controller.stop()).toThrow("Export failed");
    expect(controller.getState()).toEqual({ status: "manual", recordedFrames: 1 });
    expect(controller.completed()).toEqual([]);
    expect(demands()).toBe(1);
    failExport(false);
    expect(controller.stop()?.frames).toHaveLength(1);
  });
});

describe("automatic capture", () => {
  it("fits the largest automatic window into the recording capacity", () => {
    const { controller, frame } = setup();
    controller.arm({ ...options, beforeFrames: 599, afterFrames: 5400 });
    for (let index = 0; index < 599; index += 1) {
      frame();
    }
    frame(25);
    for (let index = 0; index < 5400; index += 1) {
      frame();
    }
    const saved = controller.completed()[0];
    expect(saved?.frames).toHaveLength(6000);
    expect(saved?.truncated).toBe(false);
    if (!saved) {
      throw new Error("Missing recording");
    }
    expect(() => serializeRecording(saved)).not.toThrow();
  });

  it("retains a completed automatic window on assembly failure without appending extra frames", () => {
    const { controller, frame, failExport } = setup();
    controller.arm({ ...options, beforeFrames: 0, afterFrames: 1 });
    frame(25);
    failExport(true);
    expect(() => frame()).toThrow("Export failed");
    expect(controller.getState()).toMatchObject({ remainingFrames: 0 });
    failExport(false);
    frame();
    expect(controller.completed()[0]?.frames.map((sample) => sample.id)).toEqual([1, 2]);
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 141 });
    controller.arm({ ...options, thresholdMs: 100 });
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 141 });
  });
  it("includes the exact before/trigger/after window, then honors cooldown", () => {
    const { controller, frame } = setup();
    controller.arm(options);
    frame();
    frame();
    const trigger = frame(25);
    expect(controller.getState()).toEqual({
      status: "collecting",
      triggerFrameId: trigger.id,
      remainingFrames: 2,
      rearm: true,
    });
    frame();
    frame();
    const saved = controller.completed()[0];
    expect(saved?.frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);
    expect(saved?.truncated).toBe(false);
    expect(saved?.capture).toEqual({
      kind: "automatic",
      triggerFrameId: 3,
      thresholdMs: 20,
      beforeFrames: 2,
      afterFrames: 2,
    });
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 189 });
    frame(50);
    expect(controller.completed()).toHaveLength(1);
    frame(50);
    expect(controller.getState()).toMatchObject({ status: "collecting", triggerFrameId: 7 });
    if (!saved) {
      throw new Error("Missing recording");
    }
    expect(() => serializeRecording(saved)).not.toThrow();
  });

  it("does not trigger at the threshold and can finish without after frames", () => {
    const { controller, frame } = setup();
    controller.arm({ ...options, beforeFrames: 0, afterFrames: 0, cooldownMs: 0 });
    frame(20);
    expect(controller.completed()).toEqual([]);
    frame(21);
    expect(controller.completed()[0]?.frames).toHaveLength(1);
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 41 });
    frame(21);
    expect(controller.completed()).toHaveLength(2);
  });

  it("marks missing prehistory as truncated", () => {
    const { controller, frame } = setup();
    controller.arm({ ...options, afterFrames: 0 });
    frame(25);
    const saved = controller.completed()[0];
    expect(saved?.truncated).toBe(true);
    if (!saved) {
      throw new Error("Missing recording");
    }
    expect(() => serializeRecording(saved)).not.toThrow();
  });

  it("finishes a collecting window after disarm and then becomes idle", () => {
    const { controller, frame, demands } = setup();
    controller.arm(options);
    frame(25);
    controller.disarm();
    controller.disarm();
    expect(controller.getState()).toMatchObject({ status: "collecting", rearm: false });
    expect(demands()).toBe(1);
    frame();
    frame();
    expect(controller.getState()).toEqual({ status: "idle" });
    expect(demands()).toBe(0);
    frame(100);
    expect(controller.completed()).toHaveLength(1);
  });

  it("applies rearming settings only to the next window", () => {
    const { controller, frame } = setup();
    controller.arm(options);
    frame(25);
    controller.disarm();
    const next = { thresholdMs: 40, beforeFrames: 0, afterFrames: 0, cooldownMs: 0 };
    controller.arm(next);
    expect(controller.getOptions()).toEqual(next);
    expect(controller.getState()).toMatchObject({ remainingFrames: 2, rearm: true });
    frame();
    frame();
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 157 });
    frame(100);
    expect(controller.completed()).toHaveLength(2);
    expect(controller.completed()[0]?.capture).toMatchObject({ thresholdMs: 20, afterFrames: 2 });
    expect(controller.completed()[1]?.capture).toMatchObject({ thresholdMs: 40, afterFrames: 0 });
  });

  it("seals an automatic window as truncated before starting manual capture", () => {
    const { controller, frame, demands } = setup();
    controller.arm(options);
    frame(25);
    controller.start();
    frame();
    expect(controller.completed()[0]?.truncated).toBe(true);
    expect(controller.completed()[0]?.capture.kind).toBe("automatic");
    expect(controller.stop()?.capture.kind).toBe("manual");
    expect(demands()).toBe(0);
  });

  it("rejects invalid settings without disturbing manual or automatic work", () => {
    const { controller, frame } = setup();
    controller.arm(options);
    frame(25);
    for (const invalid of [
      { ...options, thresholdMs: 0 },
      { ...options, beforeFrames: 600 },
      { ...options, afterFrames: 5401 },
      { ...options, cooldownMs: -1 },
      { ...options, afterFrames: 0.5 },
    ]) {
      expect(() => controller.arm(invalid)).toThrow(RangeError);
    }
    expect(controller.getState()).toMatchObject({ remainingFrames: 2 });
    controller.start();
    expect(() => controller.arm(options)).toThrow(/manual/i);
    expect(controller.getState()).toEqual({ status: "manual", recordedFrames: 0 });
  });
});

describe("capture ownership", () => {
  it("does not let disarm stop a manual capture", () => {
    const { controller, frame, demands } = setup();
    controller.start();
    controller.disarm();
    frame();
    expect(controller.getState()).toEqual({ status: "manual", recordedFrames: 1 });
    expect(demands()).toBe(1);
  });
  it("returns detached settings, history and completed data", () => {
    const { controller, frame } = setup();
    controller.arm(options);
    Reflect.set(controller.getOptions(), "thresholdMs", 999);
    expect(controller.getOptions()).toEqual(options);
    controller.start();
    frame();
    const result = controller.stop();
    Reflect.set(result?.frames[0]?.cpu ?? {}, "renderMs", 999);
    const completed = controller.completed();
    const summaries = controller.list();
    Reflect.set(summaries[0] ?? {}, "id", 999);
    expect(controller.list()[0]?.id).toBe(1);
    Reflect.set(completed[0]?.metadata.environment.timer ?? {}, "source", "wrong");
    Reflect.set(controller.recent().frames[0]?.cpu ?? {}, "updateMs", 999);
    expect(controller.completed()[0]?.frames[0]?.cpu).toEqual({ updateMs: null, renderMs: null });
    expect(controller.completed()[0]?.metadata.environment.timer.source).toBe("custom");
    expect(controller.recent().frames[0]?.cpu.updateMs).toBeNull();
  });

  it("clears all capture storage and releases demand without changing settings", () => {
    const { controller, frame, demands } = setup();
    controller.start();
    frame();
    controller.stop();
    controller.arm(options);
    frame(25);
    controller.clear();
    controller.clear();
    expect(controller.completed()).toEqual([]);
    expect(controller.getState()).toEqual({ status: "idle" });
    expect(controller.getOptions()).toEqual(options);
    expect(demands()).toBe(0);
  });

  it("disarms idle/cooldown states and makes disposal idempotent", () => {
    const { controller, frame, demands } = setup();
    controller.disarm();
    controller.arm(options);
    controller.disarm();
    expect(demands()).toBe(0);
    controller.arm({ ...options, afterFrames: 0 });
    frame(25);
    controller.disarm();
    expect(controller.getState()).toEqual({ status: "idle" });
    controller.start();
    controller.dispose();
    controller.dispose();
    controller.arm(options);
    controller.start();
    controller.disarm();
    frame();
    expect(controller.stop()).toBeNull();
    expect(controller.recent().frames).toEqual([]);
    expect(controller.completed()).toEqual([]);
    expect(demands()).toBe(0);
  });
});

import { summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";

describe("bounded slowdown episodes", () => {
  const episodeOptions = {
    ...options,
    timeWindow: { beforeMs: 30, afterMs: 30, recoveryMs: 40, maxDurationMs: 500 },
  };
  it("uses elapsed prehistory, merges repeated slow frames and retains a quiet recovery tail", () => {
    const { controller, frame } = setup();
    controller.arm(episodeOptions);
    frame(16);
    frame(16);
    frame(16);
    frame(35);
    frame(16);
    frame(35);
    frame(16);
    frame(16);
    expect(controller.completed()).toHaveLength(0);
    expect(controller.getState()).toMatchObject({
      status: "collecting",
      episode: { triggerCount: 2, remainingMs: 8 },
    });
    frame(16);
    const saved = controller.completed()[0];
    expect(saved?.frames.map((frame) => frame.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(saved?.schemaVersion).toBe(6);
    expect(saved?.capture).toMatchObject({
      triggerFrameId: 4,
      beforeFrames: 2,
      afterFrames: 5,
      episode: {
        triggerFrameIds: [4, 6],
        stopReason: "recovered",
        timeWindow: episodeOptions.timeWindow,
        cooldownMs: 100,
      },
    });
    expect(saved?.truncated).toBe(false);
    expect(controller.getState()).toEqual({ status: "cooldown", rearmAtMs: 282 });
    if (!saved) {
      throw new Error("No episode");
    }
    expect(() => serializeRecording(saved)).not.toThrow();
  });
  it("caps sustained load by elapsed duration, marks truncation, and never emits overlapping captures while collecting", () => {
    const { controller, frame } = setup();
    controller.arm({
      ...episodeOptions,
      timeWindow: { beforeMs: 0, afterMs: 30, recoveryMs: 40, maxDurationMs: 100 },
    });
    for (let index = 0; index < 4; index += 1) {
      frame(35);
    }
    expect(controller.completed()).toHaveLength(1);
    expect(controller.completed()[0]).toMatchObject({
      truncated: true,
      capture: { episode: { triggerFrameIds: [1, 2, 3, 4], stopReason: "duration-limit" } },
    });
  });
  it("caps frame storage independently of elapsed duration and exposes remaining capacity", () => {
    const { controller, frame } = setup();
    controller.arm({
      ...episodeOptions,
      thresholdMs: 0.5,
      timeWindow: { beforeMs: 0, afterMs: 100, recoveryMs: 100, maxDurationMs: 10000 },
    });
    frame(1);
    expect(controller.getProgress()).toMatchObject({
      kind: "automatic",
      remainingFrames: 5999,
      episode: { triggerCount: 1, remainingMs: 100 },
    });
    for (let index = 1; index < 6000; index += 1) {
      frame(1);
    }
    expect(controller.completed()[0]).toMatchObject({
      truncated: true,
      capture: { episode: { stopReason: "frame-capacity" } },
    });
    expect(controller.completed()[0]?.frames).toHaveLength(6000);
  });
  it("disarm stops extending the episode, manual start truncates it, and export failure preserves its closing boundary", () => {
    const { controller, frame, failExport } = setup();
    controller.arm({
      ...episodeOptions,
      timeWindow: { beforeMs: 0, afterMs: 30, recoveryMs: 40, maxDurationMs: 500 },
    });
    frame(35);
    controller.disarm();
    frame(35);
    failExport(true);
    expect(() => frame(35)).toThrow("Export failed");
    failExport(false);
    frame(35);
    expect(controller.completed()[0]?.frames).toHaveLength(3);
    expect(controller.completed()[0]?.capture).toMatchObject({
      episode: { stopReason: "disarmed", triggerFrameIds: [1, 2, 3] },
    });
    expect(controller.getState()).toEqual({ status: "idle" });
    controller.arm(episodeOptions);
    frame(35);
    controller.start();
    expect(controller.completed()[1]).toMatchObject({
      truncated: true,
      capture: { episode: { stopReason: "manual-start" } },
    });
  });
  it("copies nested settings and trigger history and rejects invalid bounds atomically", () => {
    const { controller, frame } = setup();
    controller.arm(episodeOptions);
    Reflect.set(controller.getOptions().timeWindow ?? {}, "recoveryMs", 999);
    expect(controller.getOptions()).toEqual(episodeOptions);
    for (const timeWindow of [
      { ...episodeOptions.timeWindow, beforeMs: -1 },
      { ...episodeOptions.timeWindow, maxDurationMs: 20 },
      { ...episodeOptions.timeWindow, recoveryMs: Infinity },
    ]) {
      expect(() => controller.arm({ ...episodeOptions, timeWindow })).toThrow();
    }
    frame(35);
    frame(16);
    frame(16);
    frame(16);
    const saved = controller.completed()[0];
    if (saved?.capture.kind !== "automatic") {
      throw new Error("No automatic capture");
    }
    Reflect.set(saved.capture.episode?.triggerFrameIds ?? [], "0", 999);
    expect(controller.completed()[0]?.capture).toMatchObject({ episode: { triggerFrameIds: [1] } });
    expect(saved.truncated).toBe(true);
  });
});

describe("sustained frame-budget capture", () => {
  it("waits for continuous over-budget time and records onset, confirmation and recovery", () => {
    const { controller, frame } = setup();
    controller.arm({
      ...options,
      thresholdMs: 50,
      sustainedMs: 100,
      timeWindow: { beforeMs: 100, afterMs: 20, recoveryMs: 30, maxDurationMs: 1000 },
    });
    frame(35);
    frame(16); // A short spike does not start a capture.
    frame(35);
    frame(35);
    expect(controller.list()).toHaveLength(0);
    frame(35);
    expect(controller.getState()).toMatchObject({ status: "collecting", triggerFrameId: 5 });
    frame(35); // Budget crossings extend the episode even below the old 50 ms spike setting.
    frame(16);
    frame(16);
    const recording = controller.completed()[0];
    expect(recording).toMatchObject({
      schemaVersion: 7,
      capture: {
        triggerFrameId: 5,
        thresholdMs: 1000 / 60,
        sustained: { durationMs: 100, startedAtMs: 51, firstFrameId: 3, frameCount: 3 },
        episode: { triggerFrameIds: [5, 6], stopReason: "recovered" },
      },
    });
    if (!recording) {
      throw new Error("Missing recording");
    }
    expect(() => serializeRecording(recording)).not.toThrow();
  });
  it("forgets a partial streak when disarmed or rearmed and preserves spike mode", () => {
    const { controller, frame } = setup();
    const sustained = { ...options, thresholdMs: 50, sustainedMs: 100 };
    controller.arm(sustained);
    frame(70);
    expect(controller.getState().status).toBe("armed");
    controller.disarm();
    controller.arm(sustained);
    frame(40);
    expect(controller.getState().status).toBe("armed");
    controller.arm({ ...options, thresholdMs: 50 });
    frame(51);
    expect(controller.getState().status).toBe("collecting");
    for (const value of [0, -1, NaN, Infinity, 600001]) {
      expect(() => controller.arm({ ...sustained, sustainedMs: value })).toThrow();
    }
  });
});
