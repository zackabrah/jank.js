import { buildInfo } from "../core/build-info.ts";

import { describe, expect, it } from "vitest";

import { createDiagnostics } from "../core/diagnostics.ts";

import { parseRecording, serializeRecording } from "../core/recording.ts";

import { eventsNear } from "../core/inspection.ts";

import {
  buildLanes,
  environmentLine,
  findCaptures,
  likelyScope,
  primaryCounters,
  span,
} from "./lanes.ts";

/** A recorded session on a synthetic clock: 16 ms frames with 2 ms of nested work. */
function session(automatic = false) {
  let now = 0;

  const monitor = createDiagnostics({
    now: () => now,
    application: { name: "lane fixture", version: "1.0" },
  });

  const physics = monitor.register("physics", "Physics", () => ({
    objects: 10 + Math.floor(now / 100),
    drawCalls: 3,
  }));

  monitor.register("hud", "HUD counters", () => ({ pending: 2 }));

  if (automatic)
    monitor.armCapture({
      thresholdMs: 30,
      beforeFrames: 3,
      afterFrames: 3,
      cooldownMs: 0,
    });
  else monitor.startRecording();

  const frame = (interval: number, work: number) => {
    const id = monitor.beginFrame(now);

    const outer = physics.begin();

    now += work / 2;

    const inner = physics.begin();

    now += work / 2;

    physics.end(inner);
    physics.end(outer);

    now += interval - work;

    return id;
  };

  const spikes = new Map([
    [20, 40],
    [24, 40],
    [60, 36],
  ]);

  for (let i = 0; i < 80; i++) {
    if (i === 20) monitor.event("wave 3");

    const id = frame(spikes.get(i) ?? 16, i === 20 ? 30 : 2);

    if (i % 10 === 0)
      monitor.observeGpu({
        diagnosticFrame: id,
        available: true,
        enabled: true,
        status: "ready",
        currentFrame: i + 4,
        sampleFrame: i,
        sampleAgeFrames: 4,
        gpuMilliseconds: null,
        passes: [{ label: "opaque", milliseconds: 4 }],
        droppedFrames: 0,
        truncatedPasses: 0,
        error: null,
      });
  }

  monitor.beginFrame(now);

  return parseRecording(serializeRecording(monitor.export()));
}

describe("viewer lanes", () => {
  it("draws timed systems exactly per frame and places periodic data where it was taken", () => {
    const recording = session();

    const lanes = buildLanes(recording);

    // HUD only reports counters, so it has no CPU lane.
    expect(lanes.cpu.map((lane) => lane.label)).toEqual(["Physics"]);

    const at = lanes.index.get(recording.frames[20]!.id)!;

    // Nested physics scopes count once: 30 ms of work in a 40 ms frame.
    expect(lanes.cpu[0]!.values[at]).toBeCloseTo(30);
    expect(lanes.unattributed[at]).toBeCloseTo(10);
    expect(lanes.medians.get("physics")).toBeCloseTo(2);

    const gpuAt = lanes.gpu[0]!.values.findIndex(
      (value) => !Number.isNaN(value),
    );

    expect(lanes.gpu[0]!.label).toBe("opaque");
    expect(lanes.gpuAge[gpuAt]).toBe(4);
    expect(
      lanes.gpu[0]!.values.filter((value) => !Number.isNaN(value)).length,
    ).toBe(8);
    expect(primaryCounters(lanes).map((lane) => lane.label)).toEqual([
      "draw calls",
      "objects",
    ]);

    // Counters exist only at the frames a periodic sample was taken.
    const sampled = lanes.counters[0]!.values.filter(
      (value) => !Number.isNaN(value),
    );

    expect(sampled.length).toBe(recording.samples.length);
    expect(likelyScope(lanes, at)).toMatchObject({ label: "Physics" });
    expect(likelyScope(lanes, at)?.delta).toBeCloseTo(28);
    expect(likelyScope(lanes, 5)).toBeNull();
  });

  it("lists every spike once in a manual recording and the monitor's captures in an automatic one", () => {
    const manual = findCaptures(session());

    expect(manual.rule).toBe("manual · frames over 33.3 ms");

    // Frames 20 and 24 are one spike; frame 60 is another. Longest first.
    expect(manual.marks.map((mark) => [mark.rank, mark.ms])).toEqual([
      [1, 40],
      [2, 36],
    ]);
    expect(manual.marks[0]!.near).toBe("wave 3");

    const automatic = session(true);

    const captured = findCaptures(automatic);

    expect(captured.rule).toBe("auto · threshold 30.0 ms · 3 before, 3 after");
    expect(captured.marks[0]!.id).toBe(automatic.capture.triggerFrame);
  });

  it("states the environment and events as recorded", () => {
    const recording = session();

    const lanes = buildLanes(recording);

    const line = environmentLine(recording, lanes);

    expect(line).toContain(`jank.js ${buildInfo.version}`);
    expect(line).toContain("lane fixture 1.0");
    expect(line).toContain("isolation unknown · cpu timer unknown");
    expect(line).toContain("instrumented: cpu, gpu, counters");
    expect(span(recording)).toMatch(/^\d+\.\d s$/);

    const events = eventsNear(recording, 20);

    expect(events.find((event) => event.label === "wave 3")?.offset).toBe(-1);
  });
});
