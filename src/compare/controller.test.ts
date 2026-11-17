import { afterEach, describe, expect, it, vi } from "vitest";
import { comparisonCaptureReason, createCaptureController } from "../capture/controller.ts";
import { captureFixture } from "../capture/fixtures.ts";
import { createComparisonController } from "./controller.ts";
import { parseComparison, serializeComparison, settingDifferences } from "./model.ts";

const plan = { warmupMs: 200, measureMs: 400, pairs: 2 };
function setup(capacity = 6000) {
  const fixture = captureFixture(capacity);
  const capture = createCaptureController(fixture.source);
  const activate = vi.fn();
  const restore = vi.fn();
  const comparison = createComparisonController({
    capture,
    activate,
    restore,
    change: "workload",
    variants: {
      A: { label: "Baseline", settings: { workload: "old", objects: 64 } },
      B: { label: "Candidate", settings: { workload: "new", objects: 128 } },
    },
  });
  const advance = async (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      fixture.advance(1, 100);
      comparison.advance();
      capture.refresh(fixture.source.snapshot());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { ...fixture, capture, comparison, activate, restore, advance, seal: fixture.advance };
}
afterEach(() => vi.useRealTimers());

describe("comparison runner", () => {
  it("records ABBA with no warm-up frames, restores settings and round-trips the validated bundle", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(30);
    const state = f.comparison.getSnapshot();
    expect(state.error).toBe("");
    expect(state.bundle.status).toBe("complete");
    expect(f.activate.mock.calls.map(([key]) => key)).toEqual(["A", "B", "B", "A"]);
    expect(state.bundle.trials.map((trial) => trial.recording.frames.length)).toEqual([4, 4, 4, 4]);
    expect(
      state.bundle.trials.every(
        (trial) => trial.measurementEndMs - trial.measurementStartMs === 400,
      ),
    ).toBe(true);
    expect(f.capture.getSnapshot().saved).toHaveLength(0);
    expect(f.restore).toHaveBeenCalledTimes(1);
    expect(parseComparison(serializeComparison(state.bundle))).toEqual(state.bundle);
    expect(settingDifferences(state.bundle.variants, state.bundle.change)).toEqual(["objects"]);
    expect(f.capture.recordingUnavailable()).toBe("");
  });
  it("blocks all capture entry points through warm-up, measurement and drain without cancelling", async () => {
    const f = setup();
    let resolveGpu: ((value: { version: 1; frames: [] }) => void) | undefined;
    f.source.finalizeGpu = () =>
      new Promise((resolve) => {
        resolveGpu = resolve;
      });
    f.comparison.start(plan);
    for (const frames of [0, 2, 4]) {
      await f.advance(frames);
      expect(f.comparison.getSnapshot().phase).not.toBe("idle");
      f.capture.start();
      f.capture.toggleAuto();
      expect(f.capture.getSnapshot().blocked).toBe(comparisonCaptureReason);
      expect(f.capture.getSnapshot().phase).toBe("idle");
      expect(f.capture.autoUnavailable()).toBe(comparisonCaptureReason);
    }
    expect(f.comparison.getSnapshot().phase).toBe("drain");
    f.comparison.stop();
    resolveGpu?.({ version: 1, frames: [] });
    await f.advance();
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(0);
    expect(f.restore).toHaveBeenCalledTimes(1);
  });
  it("keeps only finished trials on Stop and never adopts a late GPU result into a new run", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(7);
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(1);
    let resolveGpu: ((value: { version: 1; frames: [] }) => void) | undefined;
    f.source.finalizeGpu = () =>
      new Promise((resolve) => {
        resolveGpu = resolve;
      });
    await f.advance(5);
    expect(f.comparison.getSnapshot().phase).toBe("drain");
    f.comparison.stop();
    const partial = serializeComparison(f.comparison.getSnapshot().bundle);
    expect(parseComparison(partial).trials).toHaveLength(1);
    f.comparison.start(plan);
    resolveGpu?.({ version: 1, frames: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(0);
    expect(f.comparison.getSnapshot().phase).toBe("warmup");
    f.comparison.destroy();
  });
  it("refuses active capture and invalid plans without replacing a retained result", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(7);
    f.comparison.stop();
    f.capture.toggleAuto();
    f.comparison.start(plan);
    expect(f.comparison.getSnapshot().error).toBe("Turn off automatic capture before comparing.");
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(1);
    f.capture.toggleAuto();
    f.comparison.start({ ...plan, measureMs: Number.NaN });
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(1);
    expect(f.capture.recordingUnavailable()).toBe("");
    f.source.snapshot = () => {
      throw new Error("Collector unavailable");
    };
    expect(f.comparison.unavailable()).toBe("Collector unavailable");
    f.comparison.start(plan);
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(1);
    expect(f.comparison.getSnapshot().error).toBe("Collector unavailable");
  });
  it("interrupts external capture or budget changes, preserving external recording ownership", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(7);
    f.source.startRecording();
    f.comparison.advance();
    expect(f.comparison.getSnapshot().bundle.status).toBe("interrupted");
    expect(f.comparison.getSnapshot().bundle.trials).toHaveLength(1);
    expect(f.source.snapshot().recording).toBe(true);
    expect(f.restore).toHaveBeenCalledTimes(1);
  });
  it("stops its trial on a budget-only interruption but preserves a replacement recorder", async () => {
    for (const replaceRecorder of [false, true]) {
      const f = setup();
      f.comparison.start(plan);
      await f.advance(4);
      expect(f.comparison.getSnapshot().phase).toBe("measure");
      expect(f.comparison.getSnapshot().frames).toBe(2);
      if (replaceRecorder) f.source.startRecording();
      f.source.snapshot().budget.frameMs = 1000 / 30;
      f.comparison.advance();
      expect(f.comparison.getSnapshot().bundle.status).toBe("interrupted");
      expect(f.source.snapshot().recording).toBe(replaceRecorder);
      expect(f.restore).toHaveBeenCalledOnce();
      if (!replaceRecorder) {
        expect(f.capture.recordingUnavailable()).toBe("");
        expect(f.comparison.unavailable()).toBe("");
        f.capture.start();
        expect(f.capture.getSnapshot().phase).toBe("recording");
        f.capture.discard();
      }
    }
  });

  it("bounds a stalled GPU finalizer and a too-small recorder", async () => {
    vi.useFakeTimers();
    const f = setup();
    f.source.finalizeGpu = () => new Promise(() => {});
    f.comparison.start(plan);
    await f.advance(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.comparison.getSnapshot().error).toMatch(/finalization did not finish/);
    expect(f.capture.recordingUnavailable()).toBe("");
    const small = setup(2);
    small.comparison.start(plan);
    await small.advance(4);
    expect(small.comparison.getSnapshot().error).toMatch(/capacity/);
    expect(small.comparison.getSnapshot().bundle.trials).toHaveLength(0);
  });
  it("keeps per-frame collection independent of subscriber refresh and requires a clock anchor", () => {
    const f = setup();
    f.comparison.start(plan);
    const listener = vi.fn();
    f.comparison.subscribe(listener);
    f.seal(2, 100);
    f.comparison.advance(false);
    expect(f.comparison.getSnapshot().phase).toBe("measure");
    expect(listener).not.toHaveBeenCalled();
    f.comparison.advance();
    expect(listener).toHaveBeenCalledTimes(1);
    f.source.stopRecording();
    f.comparison.advance(false);
    expect(f.comparison.getSnapshot().phase).toBe("idle");
    expect(listener).toHaveBeenCalledTimes(1);
    f.comparison.advance();
    expect(listener).toHaveBeenCalledTimes(2);
    f.comparison.stop();
    const snapshot = f.source.snapshot;
    f.source.snapshot = () => ({ ...snapshot(), frames: [] });
    f.comparison.start(plan);
    expect(f.comparison.getSnapshot().error).toMatch(/first completed host frame/);
    expect(f.capture.recordingUnavailable()).toBe("");
  });
  it("cleans up a host that throws after starting a trial recorder", () => {
    const f = setup();
    const start = f.source.startRecording;
    f.source.startRecording = () => {
      start();
      throw new Error("Failed after start");
    };
    f.comparison.start({ ...plan, warmupMs: 0 });
    expect(f.comparison.getSnapshot().error).toBe("Failed after start");
    expect(f.source.snapshot().recording).toBe(false);
    expect(f.capture.recordingUnavailable()).toBe("");
  });
  it("restores and releases capture if variant activation throws", () => {
    const f = setup();
    f.activate.mockImplementation(() => {
      throw new Error("Variant unavailable");
    });
    f.comparison.start(plan);
    expect(f.comparison.getSnapshot().error).toBe("Variant unavailable");
    expect(f.restore).toHaveBeenCalledTimes(1);
    expect(f.capture.recordingUnavailable()).toBe("");
  });
  it("records a host failure with its cause and keeps the trials importable when it is long", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(10);
    const kept = f.comparison.getSnapshot().bundle.trials.length;
    expect(kept).toBeGreaterThan(0);
    f.comparison.fail(`Renderer failure: ${"driver log ".repeat(400)}`);
    const { bundle, error, phase } = f.comparison.getSnapshot();
    expect(phase).toBe("idle");
    expect(bundle.status).toBe("failed");
    expect(error).toContain("Renderer failure");
    expect(f.restore).toHaveBeenCalledOnce();
    const parsed = parseComparison(serializeComparison(bundle));
    expect(parsed.trials).toHaveLength(kept);
    expect(parsed.reason).toHaveLength(2000);
  });
  it("rejects malformed bundles, reordered/missing trials, bad policies and warm-up contamination", async () => {
    const f = setup();
    f.comparison.start(plan);
    await f.advance(30);
    const valid = f.comparison.getSnapshot().bundle;
    for (const mutate of [
      (bundle: typeof valid) => {
        bundle.trials.reverse();
      },
      (bundle: typeof valid) => {
        bundle.trials.pop();
      },
      (bundle: typeof valid) => {
        bundle.policy.minCoverage = 0;
      },
      (bundle: typeof valid) => {
        bundle.change = "unknown";
      },
      (bundle: typeof valid) => {
        const trial = bundle.trials[0];
        if (trial) trial.measurementStartMs += 100;
      },
      (bundle: typeof valid) => {
        bundle.budgetMs = 20;
      },
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      expect(() => parseComparison(JSON.stringify(invalid))).toThrow();
    }
  });
});
