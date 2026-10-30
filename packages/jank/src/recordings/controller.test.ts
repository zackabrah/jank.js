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
