import { expect, test, vi } from "vitest";
import { createCaptureController } from "./controller.ts";
import { captureFixture } from "./fixtures.ts";

test("disarms Auto, saves once at capacity, and keeps an owned recording", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  const changed = vi.fn();
  const unsubscribe = controller.subscribe(changed);
  controller.start();
  expect(source.snapshot().capture.mode).toBe("manual");
  advance(4);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot()).toMatchObject({
    phase: "idle",
    frames: 4,
    capacity: 4,
    elapsedMs: 90,
  });
  expect(controller.getSnapshot().saved.map((capture) => capture.id)).toEqual([1]);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().saved).toHaveLength(1);
  const last = source.snapshot().frames.at(-1);
  if (last) last.interval = 999;
  expect(controller.getSnapshot().saved[0]?.recording.frames.at(-1)?.interval).toBe(16);
  expect(changed).toHaveBeenCalled();
  unsubscribe();
  changed.mockClear();
  controller.start();
  expect(changed).not.toHaveBeenCalled();
});

test("empty and discarded recordings never save the recent buffer or clear live history", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  controller.start();
  controller.stopAndSave();
  expect(controller.getSnapshot().saved).toHaveLength(0);
  expect(controller.getSnapshot().message).toContain("No completed frames");
  controller.start();
  advance(2);
  controller.discard();
  expect(controller.getSnapshot().saved).toHaveLength(0);
  expect(source.snapshot().frames).toHaveLength(5);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().saved).toHaveLength(0);
});

test("failed save retains the buffer for retry and blocks replacement", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  controller.start();
  advance(2);
  const exported = source.export;
  source.export = () => {
    throw new Error("Export unavailable");
  };
  controller.stopAndSave();
  expect(controller.getSnapshot()).toMatchObject({ phase: "unsaved", error: "Export unavailable" });
  controller.start();
  expect(controller.getSnapshot().error).toContain("Save or discard");
  expect(source.snapshot().recordedFrames).toBe(2);
  source.export = exported;
  controller.stopAndSave();
  expect(controller.getSnapshot().saved[0]?.recording.frames).toHaveLength(2);
  expect(controller.getSnapshot().error).toBe("");
});

test("keeps the latest ten, never replaces an external recording, and validates source progress", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  source.disarmCapture();
  source.startRecording();
  advance();
  controller.refresh(source.snapshot());
  expect(controller.recordingUnavailable()).toBe("A recording is running outside this panel.");
  expect(controller.comparisonUnavailable()).toBe(
    "A recording is running outside this panel. Stop it in the host to compare.",
  );
  controller.start();
  expect(controller.getSnapshot().blocked).toBe("A recording is running outside this panel.");
  expect(controller.getSnapshot().error).toBe("");
  expect(source.snapshot().recordedFrames).toBe(1);
  source.stopRecording();
  for (let i = 0; i < 11; i++) {
    controller.start();
    advance();
    controller.stopAndSave();
  }
  expect(controller.getSnapshot().saved.map((capture) => capture.id)).toEqual([
    11, 10, 9, 8, 7, 6, 5, 4, 3, 2,
  ]);
  controller.start();
  controller.refresh({ ...source.snapshot(), recordedFrames: -1 });
  expect(controller.getSnapshot().error).toContain("invalid recorded-frame count");
});

test("starting manual capture replaces an active automatic window and disarms it", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  controller.toggleAuto();
  advance(1, 48);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot()).toMatchObject({ kind: "automatic", phase: "recording" });
  controller.start();
  expect(source.snapshot()).toMatchObject({
    recording: true,
    recordedFrames: 0,
    capture: { mode: "manual" },
  });
  expect(controller.getSnapshot().error).toBe("");
});

test("saves short automatic windows between UI refreshes, counts cooldown on the frame clock and re-arms", () => {
  const { source, advance } = captureFixture(12);
  const controller = createCaptureController(source);
  const changed = vi.fn();
  controller.subscribe(changed);
  controller.toggleAuto();
  expect(source.snapshot().capture.state).toBe("armed");
  changed.mockClear();
  advance(1, 48);
  controller.refresh(source.snapshot(), false);
  const trigger = source.snapshot().capture.triggerFrame;
  expect(controller.getSnapshot()).toMatchObject({
    kind: "automatic",
    phase: "recording",
    automatic: { state: "capturing", remainingFrames: 6 },
  });
  for (let i = 0; i < 6; i++) {
    advance(1, 16);
    controller.refresh(source.snapshot(), false);
  }
  expect(changed).not.toHaveBeenCalled();
  expect(controller.getSnapshot()).toMatchObject({
    phase: "idle",
    automatic: { state: "cooldown", cooldownRemainingMs: 5000 },
  });
  const saved = controller.getSnapshot().saved[0]?.recording;
  expect(saved?.capture.triggerFrame).toBe(trigger);
  expect(saved?.frames).toHaveLength(10); // Only three pre-trigger frames existed.
  controller.refresh(source.snapshot());
  expect(changed).toHaveBeenCalled();
  expect(controller.getSnapshot().saved).toHaveLength(1);
  for (let i = 0; i < 250; i++) {
    advance(1, 20);
    controller.refresh(source.snapshot(), false);
  }
  expect(controller.getSnapshot().automatic?.state).toBe("armed");
  advance(1, 48);
  controller.refresh(source.snapshot(), false);
  for (let i = 0; i < 6; i++) {
    advance(1, 16);
    controller.refresh(source.snapshot(), false);
  }
  expect(controller.getSnapshot().saved.map((capture) => capture.id)).toEqual([2, 1]);
  expect(saved?.frames).toHaveLength(10);
});

test("handles zero after-context and zero cooldown without missing consecutive triggers", () => {
  const { source, advance } = captureFixture(1);
  const exported = source.export;
  source.export = () => ({
    ...(exported() as object),
    capture: { ...source.snapshot().capture, beforeFrames: 0, afterFrames: 0, cooldownMs: 0 },
  });
  const controller = createCaptureController(source);
  controller.toggleAuto();
  for (let i = 0; i < 12; i++) {
    advance(1, 48);
    controller.refresh(source.snapshot(), false);
  }
  expect(controller.getSnapshot().saved.map((capture) => capture.id)).toEqual([
    12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
  ]);
  expect(
    new Set(controller.getSnapshot().saved.map((c) => c.recording.capture.triggerFrame)).size,
  ).toBe(10);
});

test("blocked arming preserves manual recording; switching Auto off discards only the active automatic window", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  controller.start();
  advance();
  controller.toggleAuto();
  expect(controller.getSnapshot().blocked).toBe(
    "Stop manual recording before arming automatic capture.",
  );
  expect(source.snapshot().recording).toBe(true);
  expect(controller.getSnapshot().automatic?.state).toBe("off");
  controller.stopAndSave();
  controller.toggleAuto();
  advance(1, 48);
  controller.refresh(source.snapshot());
  controller.toggleAuto();
  expect(source.snapshot().recording).toBe(false);
  expect(controller.getSnapshot()).toMatchObject({ phase: "idle", automatic: { state: "off" } });
  advance(4, 48);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().saved).toHaveLength(1);
});

test("an automatic export failure disarms to protect the stopped buffer, and retry saves once", () => {
  const { source, advance } = captureFixture();
  const controller = createCaptureController(source);
  controller.toggleAuto();
  advance(1, 48);
  controller.refresh(source.snapshot());
  const exported = source.export;
  source.export = () => {
    throw new Error("Export failed");
  };
  for (let i = 0; i < 2; i++) {
    advance(1, 16);
    controller.refresh(source.snapshot());
  }
  expect(controller.getSnapshot()).toMatchObject({
    phase: "unsaved",
    error: "Export failed",
    automatic: { state: "off" },
  });
  const ids = source.snapshot().recordedFrames;
  advance(10, 48);
  controller.toggleAuto();
  controller.start();
  expect(source.snapshot().recordedFrames).toBe(ids);
  source.export = exported;
  controller.stopAndSave();
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().saved).toHaveLength(1);
  expect(controller.getSnapshot().saved[0]?.recording.capture.mode).toBe("automatic");
  expect(controller.getSnapshot().automatic?.state).toBe("off");
});

test("bounds the default window by collector capacity and reports unsupported or failed arming", () => {
  const { source, advance } = captureFixture(4);
  const exported = source.export;
  source.export = () => ({
    ...(exported() as object),
    capture: { ...source.snapshot().capture, beforeFrames: 120, afterFrames: 120 },
  });
  const controller = createCaptureController(source);
  expect(controller.getSnapshot().automatic?.rule).toMatchObject({
    beforeFrames: 3,
    afterFrames: 0,
  });
  source.export = exported;
  const arm = source.armCapture;
  source.armCapture = vi.fn();
  controller.toggleAuto();
  expect(controller.getSnapshot().error).toContain("did not arm");
  expect(controller.getSnapshot().automatic?.state).toBe("off");
  if (!arm) throw new Error("Missing fixture arm method");
  source.armCapture = arm;
  controller.toggleAuto();
  advance(1, 48);
  controller.refresh(source.snapshot());
  expect(controller.getSnapshot().saved[0]?.recording.frames).toHaveLength(4);
  const unsupported = captureFixture().source;
  delete unsupported.armCapture;
  const readonly = createCaptureController(unsupported);
  readonly.toggleAuto();
  expect(readonly.getSnapshot().blocked).toContain("does not support");
  expect(readonly.getSnapshot().automatic).toBeNull();
});

test("finalization fixes the CPU window, blocks replacement and saves delayed GPU evidence once", async () => {
  const fixture = captureFixture();
  let finish: ((value: { version: 1; frames: [] }) => void) | undefined;
  fixture.source.finalizeGpu = vi.fn(
    () =>
      new Promise<{ version: 1; frames: [] }>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createCaptureController(fixture.source);
  controller.start();
  fixture.advance(2);
  controller.stopAndSave();
  expect(controller.getSnapshot().phase).toBe("finalizing");
  controller.start();
  controller.toggleAuto();
  controller.stopAndSave();
  expect(controller.getSnapshot().phase).toBe("finalizing");
  fixture.advance(5);
  controller.refresh(fixture.source.snapshot());
  await Promise.resolve();
  finish?.({ version: 1, frames: [] });
  await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("idle"));
  expect(controller.getSnapshot().saved[0]?.recording.frames).toHaveLength(2);
  expect(fixture.source.finalizeGpu).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().saved).toHaveLength(1);
});

test("discard cancels an in-flight finalizer; failed finalization can retry the owned recording", async () => {
  const fixture = captureFixture();
  let finish: ((value: { version: 1; frames: [] }) => void) | undefined;
  let signal: AbortSignal | undefined;
  fixture.source.finalizeGpu = (_recording, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const controller = createCaptureController(fixture.source);
  controller.start();
  fixture.advance();
  controller.stopAndSave();
  await Promise.resolve();
  controller.discard();
  expect(signal?.aborted).toBe(true);
  finish?.({ version: 1, frames: [] });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(controller.getSnapshot().saved).toHaveLength(0);
  fixture.source.finalizeGpu = vi.fn().mockRejectedValue(new Error("Unavailable GPU source"));
  controller.start();
  fixture.advance();
  controller.stopAndSave();
  await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("unsaved"));
  expect(controller.getSnapshot().error).toContain("Unavailable");
  fixture.source.finalizeGpu = async () => ({ version: 1, frames: [] });
  controller.stopAndSave();
  await vi.waitFor(() => expect(controller.getSnapshot().saved).toHaveLength(1));
});

test("holds automatic arming during finalization and resumes after the original cooldown", async () => {
  const fixture = captureFixture(1);
  fixture.source.finalizeGpu = async () => ({ version: 1, frames: [] });
  const controller = createCaptureController(fixture.source);
  controller.toggleAuto();
  fixture.advance(1, 48);
  controller.refresh(fixture.source.snapshot());
  expect(controller.getSnapshot().phase).toBe("finalizing");
  expect(fixture.source.snapshot().capture.state).toBe("idle");
  await vi.waitFor(() => expect(controller.getSnapshot().saved).toHaveLength(1));
  fixture.advance(1, 48);
  controller.refresh(fixture.source.snapshot());
  expect(controller.getSnapshot().automatic?.state).toBe("cooldown");
  fixture.advance(300, 20);
  controller.refresh(fixture.source.snapshot());
  expect(controller.getSnapshot().automatic?.state).toBe("armed");
  fixture.advance(1, 48);
  controller.refresh(fixture.source.snapshot());
  await vi.waitFor(() => expect(controller.getSnapshot().saved).toHaveLength(2));
});

test("a host finalizer that never settles times out without losing the stopped capture", async () => {
  vi.useFakeTimers();
  try {
    const fixture = captureFixture();
    fixture.source.finalizeGpu = () => new Promise(() => {});
    const controller = createCaptureController(fixture.source);
    controller.start();
    fixture.advance();
    controller.stopAndSave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot()).toMatchObject({ phase: "unsaved", frames: 1, saved: [] });
    expect(controller.getSnapshot().error).toContain("did not finish");
    fixture.source.finalizeGpu = async () => ({ version: 1, frames: [] });
    controller.stopAndSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().saved).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
