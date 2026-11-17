import { expect, test } from "vitest";
import { analyzeRecording } from "../agent/analyze.ts";
import { parseRecording, serializeRecording } from "../recording/format.ts";
import { createDiagnostics } from "./diagnostics.ts";
import { recordingSummary } from "./inspection.ts";

test("resetFrame drops only unfinished work and keeps the recording and clock", () => {
  let now = 0;
  const monitor = createDiagnostics(() => now);
  const channel = monitor.register("work", "Work");
  monitor.startRecording();
  const first = monitor.beginFrame(now);
  now = 16;
  const discarded = monitor.beginFrame(now);
  const crossing = channel.begin();
  monitor.endFrame(50, 50);
  monitor.recordOverhead("refresh", 50);
  monitor.resetFrame();
  monitor.resetFrame();
  expect(monitor.recording).toBe(true);
  now += 7200;
  const resumed = monitor.beginFrame(now);
  channel.end(crossing);
  const scope = channel.begin();
  now += 2;
  channel.end(scope);
  monitor.endFrame(2, 0);
  now += 14;
  monitor.beginFrame(now);
  monitor.stopRecording();
  const recording = parseRecording(serializeRecording(monitor.export()));
  expect(recording.frames.map((frame) => frame.id)).toEqual([first, resumed]);
  expect(resumed).toBeGreaterThan(discarded);
  expect(recording.frames.map((frame) => frame.interval)).toEqual([16, 16]);
  expect(recording.frames[1]).toMatchObject({
    at: 7232,
    update: 2,
    render: 0,
    scopes: [{ system: "work", label: "Work", start: 7216, end: 7218 }],
    overhead: { refreshMs: 0 },
  });
  const report = analyzeRecording(recording);
  expect(report.summary).toMatchObject({ frames: 2, durationMs: 7232, fps: 62.5 });
  expect(report.summary.fps).toBe(recordingSummary(recording).fps);
  expect(report.episodes).toEqual([]);
  expect(report.eventCosts).toEqual([]);
  monitor.dispose();
  expect(() => monitor.resetFrame()).not.toThrow();
});

test("a known pause does not trigger capture, but a real stall still does", () => {
  let now = 0;
  const monitor = createDiagnostics(() => now);
  monitor.armCapture({ thresholdMs: 40, beforeFrames: 0, afterFrames: 1 });
  monitor.beginFrame(now);
  now = 16;
  monitor.beginFrame(now);
  monitor.resetFrame();
  now += 7200;
  monitor.beginFrame(now);
  now += 16;
  monitor.beginFrame(now);
  expect(monitor.snapshot().capture.state).toBe("armed");
  now += 80;
  monitor.beginFrame(now);
  expect(monitor.snapshot().capture.state).toBe("recording");
  monitor.resetFrame();
  now += 7200;
  monitor.beginFrame(now);
  expect(monitor.snapshot().capture.remainingFrames).toBe(1);
  now += 16;
  monitor.beginFrame(now);
  expect(monitor.export().frames.map((frame) => frame.interval)).toEqual([80, 16]);
  expect(monitor.recording).toBe(false);
  monitor.dispose();
});

test("unmarked pauses remain measurable stalls", () => {
  const monitor = createDiagnostics(() => 0);
  monitor.startRecording();
  monitor.beginFrame(0);
  monitor.beginFrame(7200);
  expect(analyzeRecording(monitor.export()).episodes[0]?.worstMs).toBe(7200);
  monitor.dispose();
});
