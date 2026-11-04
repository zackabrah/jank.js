import { expect, test, vi } from "vitest";
import { parseRecording } from "../recording/format.ts";
import type { RuleSettings } from "../recording/types.ts";
import { createCaptureController } from "./controller.ts";
import { captureFixture } from "./fixtures.ts";
import { createRuleCaptureSource } from "./rule-source.ts";
import { compileRule, ruleLimits } from "./rules.ts";

function harness(settings: Partial<RuleSettings> = {}, capacity = 100) {
  const fixture = captureFixture(capacity);
  const source = createRuleCaptureSource(fixture.source);
  const controller = createCaptureController(source);
  controller.applyRule({
    ...controller.getRuleSettings(),
    beforeSeconds: 2 / 60,
    afterSeconds: 2 / 60,
    cooldownMs: 100,
    ...settings,
  });
  controller.toggleAuto();
  return {
    fixture,
    source,
    controller,
    frame(interval: number) {
      fixture.advance(1, interval);
      controller.refresh(source.snapshot(), false);
    },
    saved: () => controller.getSnapshot().saved[0]?.recording,
  };
}

test("rounds context up at the arm-time budget and rejects impossible windows and durations", () => {
  const { controller } = harness();
  const settings = controller.getRuleSettings();
  expect(
    compileRule(
      { ...settings, beforeSeconds: 2, afterSeconds: 1 },
      1000 / 60,
      ruleLimits(6000, true),
    ),
  ).toMatchObject({ beforeFrames: 120, afterFrames: 60 });
  expect(
    compileRule({ ...settings, beforeSeconds: 0.02 }, 1000 / 60, ruleLimits(100, true))
      .beforeFrames,
  ).toBe(2);
  expect(() =>
    compileRule({ ...settings, beforeSeconds: 10 }, 1000 / 60, ruleLimits(6000, true)),
  ).toThrow("host limit");
  expect(() =>
    compileRule(
      { ...settings, beforeSeconds: 0.1, afterSeconds: 0.1 },
      1000 / 60,
      ruleLimits(12, true),
    ),
  ).toThrow("must fit");
  expect(() =>
    compileRule({ ...settings, keep: "episode", limitMs: 10 }, 1000 / 60, ruleLimits(100, true)),
  ).toThrow("quiet");
  expect(() =>
    compileRule(
      { ...settings, mode: "sustained", keep: "episode", limitMs: 200 },
      1000 / 60,
      ruleLimits(100, true),
    ),
  ).toThrow("sustained duration");
  expect(() =>
    compileRule({ ...settings, thresholdMs: Number.NaN }, 1000 / 60, ruleLimits(100, true)),
  ).toThrow("Threshold");
});

test("sustained resets on a healthy frame; keeps exact context and saves once between renders", () => {
  const h = harness({ mode: "sustained", sustainedMs: 80 });
  const notify = vi.fn();
  h.controller.subscribe(notify);
  for (const interval of [40, 16, 40]) h.frame(interval);
  expect(h.saved()).toBeUndefined();
  h.frame(40); // f7, onset f6
  expect(h.controller.getSnapshot()).toMatchObject({
    phase: "recording",
    automatic: { stage: "after", remainingFrames: 2 },
  });
  h.frame(16);
  h.frame(16);
  const recording = h.saved();
  expect(h.controller.getSnapshot().error).toBe("");
  expect(recording?.frames.map((f) => f.id)).toEqual([5, 6, 7, 8, 9]);
  expect(recording?.capture.context).toMatchObject({
    onsetFrame: 6,
    endFrame: 7,
    crossings: 2,
    beforeFrames: 2,
    afterFrames: 2,
    reason: "window",
  });
  expect(recording?.capture.triggerFrame).toBe(7);
  expect(recording?.overhead.frames).toBe(5);
  expect(recording?.overhead.collection.mean).toBeCloseTo(0.01);
  expect(notify).not.toHaveBeenCalled();
  h.controller.refresh(h.source.snapshot());
  h.controller.refresh(h.source.snapshot());
  expect(h.controller.getSnapshot().saved).toHaveLength(1);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(recording?.frames.every((f) => f.coverage === "complete" && f.scopes.length === 1)).toBe(
    true,
  );
});

test("whole episode merges later crossings until quiet, then keeps after-context without extending", () => {
  const h = harness({ mode: "episode", keep: "episode", sustainedMs: 60, quietMs: 32 });
  for (const interval of [30, 30, 16, 30, 16]) h.frame(interval);
  expect(h.controller.getSnapshot().automatic?.stage).toBe("episode");
  h.frame(16); // quiet at f9
  expect(h.controller.getSnapshot().automatic).toMatchObject({
    stage: "after",
    remainingFrames: 2,
  });
  h.frame(48);
  h.frame(16); // crossing during after-context doesn't merge
  expect(h.controller.getSnapshot().error).toBe("");
  expect(h.saved()?.capture).toMatchObject({
    triggerFrame: 5,
    context: {
      onsetFrame: 4,
      endFrame: 9,
      reason: "recovered",
      crossings: 3,
      beforeFrames: 2,
      afterFrames: 2,
    },
  });
  expect(h.saved()?.frames.map((f) => f.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  expect(h.controller.getSnapshot().automatic).toMatchObject({
    state: "cooldown",
    cooldownRemainingMs: 100,
  });
  h.frame(48);
  h.frame(48);
  expect(h.controller.getSnapshot().saved).toHaveLength(1);
  h.frame(30);
  h.frame(30);
  expect(h.controller.getSnapshot().automatic?.state).toBe("capturing");
});

test("episode hard time and frame limits retain the buffer and report clipped after-context", () => {
  const timed = harness({ keep: "episode", quietMs: 32, limitMs: 100 });
  timed.frame(48);
  timed.frame(48);
  timed.frame(48);
  expect(timed.saved()?.capture.context).toMatchObject({
    reason: "limit",
    endFrame: 6,
    afterFrames: 0,
  });
  const tail = harness({ keep: "episode", quietMs: 16, limitMs: 100, afterSeconds: 0.1 });
  tail.frame(48);
  tail.frame(16);
  tail.frame(48);
  expect(tail.saved()?.capture.context).toMatchObject({
    reason: "limit",
    endFrame: 5,
    afterFrames: 1,
  });
  const capped = harness({ keep: "episode", quietMs: 32 }, 6);
  for (let i = 0; i < 4; i++) capped.frame(48);
  expect(capped.controller.getSnapshot().error).toBe("");
  expect(capped.saved()?.frames).toHaveLength(6);
  expect(capped.saved()?.capture.context).toMatchObject({ reason: "capacity", afterFrames: 0 });
});

test("zero context/cooldown saves consecutive frames; export failure preserves retry data", () => {
  const h = harness({ beforeSeconds: 0, afterSeconds: 0, cooldownMs: 0 });
  h.frame(48);
  h.frame(48);
  expect(h.controller.getSnapshot().saved).toHaveLength(2);
  expect(h.saved()?.frames).toHaveLength(1);
  const exported = h.source.export;
  h.source.export = () => {
    throw new Error("Export unavailable");
  };
  h.frame(48);
  expect(h.controller.getSnapshot()).toMatchObject({
    phase: "unsaved",
    automatic: { state: "off" },
  });
  h.frame(48);
  h.frame(48);
  h.source.export = exported;
  h.controller.stopAndSave();
  expect(h.controller.getSnapshot().saved).toHaveLength(3);
  expect(h.saved()?.capture.triggerFrame).toBe(6);
  const owned = h.saved();
  const raw = h.fixture.source.snapshot().frames.at(-1);
  if (raw) raw.interval = 999;
  expect(owned?.frames[0]?.interval).toBe(48);
  expect(owned?.frames[0]?.scopes).toHaveLength(1);
});

test("invalid drafts and collector refusal preserve the rule; apply re-arms and manual start disarms", () => {
  const h = harness();
  const original = h.controller.getSnapshot().automatic?.rule;
  expect(() =>
    h.controller.applyRule({ ...h.controller.getRuleSettings(), beforeSeconds: -1 }),
  ).toThrow();
  expect(h.controller.getSnapshot().automatic?.rule).toEqual(original);
  const arm = h.source.armCapture;
  h.source.armCapture = (rule) => {
    if (rule.mode === "sustained") throw new Error("Host refused");
    arm?.(rule);
  };
  expect(() =>
    h.controller.applyRule({ ...h.controller.getRuleSettings(), mode: "sustained" }),
  ).toThrow("Host refused");
  expect(h.source.snapshot().capture.state).toBe("armed");
  expect(h.controller.getSnapshot().automatic?.rule).toEqual(original);
  if (arm) h.source.armCapture = arm;
  h.controller.applyRule({ ...h.controller.getRuleSettings(), thresholdMs: 60 });
  h.frame(48);
  expect(h.controller.getSnapshot().phase).toBe("idle");
  h.frame(70);
  expect(() => h.controller.applyRule(h.controller.getRuleSettings())).toThrow("Wait for");
  h.controller.start();
  h.frame(16);
  h.controller.stopAndSave();
  expect(h.controller.getSnapshot().automatic?.state).toBe("off");
  expect(h.saved()?.capture.mode).toBe("manual");
  expect(h.saved()?.capture.context).toBeUndefined();
});

test("round-trips context, rejects inconsistent metadata, and retains legacy imports", () => {
  const h = harness();
  h.frame(48);
  h.frame(16);
  h.frame(16);
  const original = h.saved();
  if (!original?.capture.context) throw new Error(h.controller.getSnapshot().error || "No context");
  expect(parseRecording(JSON.stringify(original))).toEqual(original);
  for (const patch of [
    { triggerAt: -1 },
    { endFrame: 1000 },
    { beforeFrames: 0 },
    { onsetFrame: 1000 },
    { reason: "invented" },
  ]) {
    const changed = structuredClone(original);
    Object.assign(changed.capture.context ?? {}, patch);
    expect(() => parseRecording(JSON.stringify(changed))).toThrow();
  }
  const legacy = structuredClone(original);
  delete legacy.capture.context;
  expect(parseRecording(JSON.stringify(legacy)).capture.context).toBeUndefined();
});

test("missed observations and restarted sources report integration errors instead of inventing frames", () => {
  const h = harness();
  h.fixture.advance(2, 48);
  h.controller.refresh(h.source.snapshot());
  expect(h.controller.getSnapshot().error).toContain("every sealed frame");
  const restarted = harness();
  const snapshot = restarted.source.snapshot();
  restarted.controller.refresh({ ...snapshot, frames: snapshot.frames.slice(0, 1) });
  expect(restarted.controller.getSnapshot().error).toContain("restarted");
});

test("a manual recording started outside the wrapper is not replaced", () => {
  const h = harness();
  h.fixture.source.startRecording();
  h.fixture.advance(1, 16);
  h.controller.start();
  expect(h.controller.getSnapshot().blocked).toContain("outside this panel");
  expect(h.fixture.source.snapshot().recordedFrames).toBe(1);
});

test("active sustained rules retain their budget until re-armed, including exported context", () => {
  const h = harness({ mode: "sustained", sustainedMs: 60 });
  const budget = h.fixture.source.snapshot().budget;
  budget.frameMs = 50;
  if ("targetFps" in budget) budget.targetFps = 20;
  h.frame(30);
  h.frame(30);
  h.frame(16);
  h.frame(16);
  expect(h.saved()?.capture.context?.rule.budgetMs).toBeCloseTo(1000 / 60);
  expect(h.saved()?.budget.frameMs).toBeCloseTo(1000 / 60);
  h.controller.applyRule(h.controller.getRuleSettings());
  expect(h.controller.getSnapshot().automatic?.rule.budgetMs).toBe(50);
  h.frame(30);
  h.frame(30);
  expect(h.controller.getSnapshot().phase).toBe("idle");
  expect(h.controller.getSnapshot().saved).toHaveLength(1);
});
