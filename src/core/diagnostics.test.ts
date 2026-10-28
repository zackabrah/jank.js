import { describe, expect, it } from "vitest";

import { createDiagnostics } from "./diagnostics.ts";

import { inspectFrame } from "./inspection.ts";

import { parseRecording, serializeRecording } from "./recording.ts";

describe("exact frame capture", () => {
  it("tolerates repeated coarse frame timestamps without inventing zero-length frames", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.startRecording();

    const first = monitor.beginFrame(0);

    monitor.endFrame(1, 2);

    expect(monitor.beginFrame(0)).toBe(first);

    monitor.endFrame(2, 3);

    expect(monitor.snapshot().frames).toHaveLength(0);

    now = 20;

    monitor.beginFrame(now);

    expect(
      parseRecording(serializeRecording(monitor.export())).frames[0],
    ).toMatchObject({ id: first, interval: 20, update: 3, render: 5 });
  });

  // What: when repeated timestamps add work into one frame, a total that would overflow to
  // Infinity is not added, so the frame keeps finite work and the recording still loads.
  // Why: fast-check found this. Two host-reported render times that are each finite (1.8e308
  // and 1e292 ms) summed to Infinity, and the viewer then refused the whole recording.
  it("keeps a frame's work finite when added work would overflow", () => {
    const monitor = createDiagnostics(() => 0);

    monitor.startRecording();
    monitor.beginFrame(0);
    monitor.endFrame(0, Number.MAX_VALUE);
    monitor.beginFrame(0);
    monitor.endFrame(0, 9.9792015476736e291);
    monitor.beginFrame(16);

    const frame = parseRecording(serializeRecording(monitor.export()))
      .frames[0];

    expect(frame).toMatchObject({ update: 0, render: Number.MAX_VALUE });
  });

  it("unions nested and overlapping systems and does not invent CPU work in the remainder", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.startRecording();
    monitor.beginFrame(0);

    const a = monitor.register("a", "Parent"),
      b = monitor.register("b", "Child");

    now = 2;

    const parent = a.begin();

    now = 4;

    const child = b.begin();

    now = 8;

    b.end(child);

    now = 10;

    a.end(parent);
    a.end(parent);

    monitor.endFrame(10, 0);

    now = 20;

    monitor.beginFrame(now);

    const recording = parseRecording(serializeRecording(monitor.export()));

    const inspection = inspectFrame(recording, 1)!;

    expect(inspection.trackedMs).toBe(8);
    expect(inspection.unattributedMs).toBe(12);
    expect(
      inspection.systemTimings.map((system) => system.inclusiveMs),
    ).toEqual([8, 4]);
    expect(inspection.frame.coverage).toBe("complete");

    const snapshot = monitor.snapshot();

    snapshot.frames[0]!.scopes[0]!.end = 999;
    snapshot.frames[0]!.overhead.collectionMs = 999;

    expect(monitor.snapshot().frames[0]?.scopes[0]?.end).toBe(8);
    expect(monitor.snapshot().frames[0]?.overhead.collectionMs).not.toBe(999);
    expect(recording.metadata.environment.cpuTimer.source).toBe("custom");
    expect(
      recording.metadata.environment.cpuTimer.estimatedResolutionMs,
    ).toBeNull();
  });

  it("clips scopes crossing frame boundaries and rejects mixed sampling APIs", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.startRecording();
    monitor.beginFrame(0);

    const channel = monitor.register("a", "A");

    now = 5;

    const token = channel.begin();

    now = 10;

    monitor.beginFrame(10);

    now = 15;

    channel.end(token);

    now = 20;

    monitor.beginFrame(20);

    const frames = monitor.export().frames;

    expect(frames.map((frame) => frame.scopes)).toEqual([
      [{ system: "a", label: "A", start: 5, end: 10 }],
      [{ system: "a", label: "A", start: 10, end: 15 }],
    ]);
    expect(() => monitor.frame(20, 10, 0, 0)).toThrow("Do not mix");
    expect(() => monitor.beginFrame(19)).toThrow("increase");

    monitor.dispose();

    channel.end(token);

    expect(monitor.beginFrame(30)).toBe(-1);
  });

  it("retains scope tails when an animation timestamp precedes already completed work", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.startRecording();
    monitor.beginFrame(0);

    const system = monitor.register("x", "X");

    now = 2;

    const token = system.begin();

    now = 8;

    system.end(token);

    now = 10;

    monitor.beginFrame(5);

    now = 15;

    monitor.beginFrame(10);

    const recording = parseRecording(serializeRecording(monitor.export()));

    expect(recording.frames.map((frame) => frame.scopes)).toEqual([
      [{ system: "x", label: "X", start: 2, end: 5 }],
      [{ system: "x", label: "X", start: 5, end: 8 }],
    ]);
    expect(
      recording.frames.reduce(
        (sum, frame) => sum + inspectFrame(recording, frame.id)!.trackedMs!,
        0,
      ),
    ).toBe(6);
  });

  it("reports truncated scopes and missing legacy attribution honestly", () => {
    let now = 0;

    const monitor = createDiagnostics({ now: () => now, maxScopesPerFrame: 1 });

    monitor.startRecording();
    monitor.beginFrame(0);

    const channel = monitor.register("a", "A");

    now = 1;

    const a = channel.begin();

    const b = channel.begin();

    now = 2;

    channel.end(a);
    channel.end(b);

    now = 10;

    monitor.beginFrame(10);

    expect(monitor.export().frames[0]).toMatchObject({
      coverage: "truncated",
      droppedScopes: 1,
    });

    const old = createDiagnostics(() => now);

    old.frame(20, 10, 1, 2);

    expect(inspectFrame(old.export(), 1)?.unattributedMs).toBeNull();
  });

  it("captures bounded pre/post spike frames and honors cooldown", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.armCapture({
      thresholdMs: 30,
      beforeFrames: 2,
      afterFrames: 1,
      cooldownMs: 100,
    });
    monitor.beginFrame(0);

    for (const at of [10, 20, 60, 70]) {
      now = at;

      monitor.beginFrame(at);
    }

    expect(monitor.recording).toBe(false);
    expect(monitor.export().frames.map((frame) => frame.id)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(monitor.export().capture).toMatchObject({
      mode: "automatic",
      state: "cooldown",
      triggerFrame: 3,
    });

    now = 110;

    monitor.beginFrame(now);

    expect(monitor.recording).toBe(false);

    now = 180;

    monitor.beginFrame(now);

    expect(monitor.recording).toBe(true);

    monitor.disarmCapture();

    now = 190;

    monitor.beginFrame(now);

    expect(monitor.recording).toBe(false);
  });

  it("records overhead independently and validates budgets/configuration", () => {
    let now = 0,
      cost = 0;

    const monitor = createDiagnostics({
      now: () => now,
      costClock: () => ++cost,
      targetFps: 120,
    });

    monitor.beginFrame(0);
    monitor.recordOverhead("refresh", 0.5);

    now = 10;

    monitor.beginFrame(10);

    expect(monitor.snapshot().overhead.refresh.mean).toBe(0.5);
    expect(monitor.snapshot().overhead.collection.mean).toBeGreaterThan(0);
    expect(monitor.snapshot().budget.frameMs).toBeCloseTo(8.333333);
    expect(() => monitor.setTargetFps(NaN)).toThrow("Target FPS");
    expect(() => monitor.armCapture({ beforeFrames: 600 })).toThrow(
      "Invalid spike",
    );

    const channel = monitor.register("x", "X");

    expect(() => monitor.register("x", "X")).toThrow("already registered");

    channel.dispose();

    const exported = monitor.export();

    exported.frames.length = 0;

    expect(monitor.snapshot().frames).toHaveLength(1);
  });

  it("does not double-count collection inside a view refresh", () => {
    let clock = 0;

    const monitor = createDiagnostics({
      now: () => 0,
      costClock: () => clock++,
    });

    monitor.beginFrame(0);
    monitor.measureRefresh(() => monitor.snapshot());
    monitor.beginFrame(10);

    // Refresh spans 3 clock ticks; snapshot collection owns 1 of them.
    expect(monitor.snapshot().frames[0]?.overhead).toEqual({
      collectionMs: 2,
      refreshMs: 2,
    });
  });

  it("marks gaps in instrumentation and disposing unfinished scopes", () => {
    let now = 0;

    const monitor = createDiagnostics(() => now);

    monitor.setExpanded(true);
    monitor.beginFrame(0);
    monitor.setExpanded(false);
    monitor.setExpanded(true);

    now = 10;

    monitor.beginFrame(10);

    expect(monitor.snapshot().frames[0]?.coverage).toBe("unavailable");

    const old = monitor.register("x", "X");

    old.begin();
    old.dispose();

    monitor.register("x", "Replacement");

    old.dispose();

    now = 20;

    monitor.beginFrame(20);

    expect(monitor.snapshot().systems[0]?.label).toBe("Replacement");
    expect(monitor.snapshot().frames[1]?.coverage).toBe("truncated");
  });
});
