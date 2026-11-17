import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { analyzeRecording } from "../src/agent/analyze.ts";
import { inspectFrame, recordingSummary } from "../src/core/inspection.ts";
import { readLive } from "../src/live/model.ts";
import { parseRecording } from "../src/recording/format.ts";
import { origin, servePackage } from "./serve-package.ts";

/** Observe the upstream panels without replacing their calculations or canvas drawing. */
async function compareWithStats(mode: "controlled" | "animation") {
  interface Panel {
    dom: HTMLElement;
    update(value: number, max: number): void;
  }
  interface StatsInstance {
    REVISION: number;
    dom: HTMLElement;
    begin(): void;
    end(): number;
    update(): void;
  }
  const Stats = Reflect.get(window, "Stats") as {
    new (): StatsInstance;
    Panel: new (name: string, foreground: string, background: string) => Panel;
  };
  const NativePanel = Stats.Panel;
  const observedStats = () => {
    const ms: number[] = [];
    const fps: number[] = [];
    Stats.Panel = class extends NativePanel {
      constructor(name: string, foreground: string, background: string) {
        super(name, foreground, background);
        const update = this.update.bind(this);
        this.update = (value, max) => {
          if (name === "MS") ms.push(value);
          if (name === "FPS") fps.push(value);
          update(value, max);
        };
      }
    };
    const stats = new Stats();
    Stats.Panel = NativePanel;
    document.body.append(stats.dom);
    return { stats, ms, fps };
  };
  const entry = "/index.js";
  const { createDiagnostics, serializeRecording } = await import(entry);
  let clock = 0;
  const previousClock = Object.getOwnPropertyDescriptor(performance, "now");
  if (mode === "controlled")
    Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
  const monitor = createDiagnostics(
    mode === "controlled" ? { now: () => clock, costClock: () => 0 } : {},
  );
  const channel = monitor.register("work", "CPU work");
  const frameStats = observedStats();
  const workStats = observedStats();
  const rows: { id: number; frameMs: number; workMs: number }[] = [];
  const windows: { firstId: number; lastId: number; fps: number }[] = [];
  let pendingId: number | null = null;
  let firstId: number | null = null;
  const end = frameStats.stats.end.bind(frameStats.stats);
  // Use Stats.js's actual end timestamp as the shared frame boundary, not a second timer read.
  frameStats.stats.end = () => {
    const before = frameStats.fps.length;
    const at = end();
    const sealed = pendingId;
    pendingId = monitor.beginFrame(at);
    if (sealed !== null)
      rows.push({
        id: sealed,
        frameMs: frameStats.ms.at(-1) ?? 0,
        workMs: workStats.ms.at(-1) ?? 0,
      });
    if (frameStats.fps.length > before) {
      // The first Stats window includes its bootstrap update, which has no sealed jank frame.
      if (firstId !== null && sealed !== null)
        windows.push({ firstId, lastId: sealed, fps: frameStats.fps.at(-1) ?? 0 });
      firstId = pendingId;
    }
    return at;
  };
  try {
    monitor.startRecording();
    frameStats.stats.update();
    const work = (milliseconds: number) => {
      workStats.stats.begin();
      const token = channel.begin();
      if (mode === "controlled") clock += milliseconds;
      else {
        const values = Float64Array.from({ length: 8000 }, (_, i) => Math.sin(i * 17));
        values.sort();
        if (values[0] === undefined) throw new Error("Workload did not run");
      }
      channel.end(token);
      workStats.stats.end();
      monitor.endFrame(0, 0);
    };
    if (mode === "controlled") {
      for (let frame = 0; frame < 420; frame++) {
        const interval =
          frame >= 300 && frame <= 302
            ? 0
            : frame === 200
              ? 80
              : frame < 180
                ? 1000 / 60
                : 14 + (frame % 5);
        const start = clock;
        work(interval === 0 || frame % 4 === 0 ? 0 : frame % 3 === 0 ? 8 : 2);
        clock = start + interval;
        frameStats.stats.update();
      }
    } else {
      await new Promise<void>((resolve) => {
        const frame = () => {
          work(0);
          frameStats.stats.update();
          if (windows.length >= 3 && rows.length >= 90) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    }
    monitor.stopRecording();
    return {
      revision: frameStats.stats.REVISION,
      recording: serializeRecording(monitor.export()) as string,
      rows,
      windows,
    };
  } finally {
    monitor.dispose();
    if (mode === "controlled") {
      if (previousClock) Object.defineProperty(performance, "now", previousClock);
      else Reflect.deleteProperty(performance, "now");
    }
  }
}

for (const mode of ["controlled", "animation"] as const) {
  test(`matches upstream Stats.js frame time, scoped work and aligned FPS windows (${mode})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await servePackage(page, "<!doctype html><title>Stats.js reference</title>");
    await page.goto(origin);
    await page.addScriptTag({
      content: await readFile(new URL(import.meta.resolve("stats.js")), "utf8"),
    });
    const result = await page.evaluate(compareWithStats, mode);
    const recording = parseRecording(result.recording);
    expect(result.revision).toBe(16);
    expect(result.windows.length).toBeGreaterThanOrEqual(3);
    expect(recording.frames).toHaveLength(new Set(result.rows.map((row) => row.id)).size);
    const workErrors: number[] = [];
    for (const frame of recording.frames) {
      const reference = result.rows.filter((row) => row.id === frame.id);
      expect(reference.length).toBeGreaterThan(0);
      // Repeated coarse timestamps count in Stats.js; jank keeps one measurable interval.
      expect(reference.slice(0, -1).every((row) => row.frameMs === 0)).toBe(true);
      expect(frame.interval).toBeCloseTo(
        reference.reduce((sum, row) => sum + row.frameMs, 0),
        7,
      );
      const scopeMs = inspectFrame(recording, frame.id)?.trackedMs;
      if (scopeMs === null || scopeMs === undefined) throw new Error("Missing CPU scope");
      const error = reference.reduce((sum, row) => sum + row.workMs, 0) - scopeMs;
      // Stats brackets enclose the jank scope and its instrumentation; they cannot be shorter.
      expect(error).toBeGreaterThanOrEqual(-1e-6);
      if (mode === "controlled") expect(error).toBeCloseTo(0, 7);
      workErrors.push(error);
    }
    const fpsChecks = result.windows.map((window) => {
      const aligned = {
        ...recording,
        frames: recording.frames.filter(
          (frame) => frame.id >= window.firstId && frame.id <= window.lastId,
        ),
      };
      const callbacks = result.rows.filter(
        (row) => row.id >= window.firstId && row.id <= window.lastId,
      ).length;
      const repeatedTimestamps = callbacks - aligned.frames.length;
      const measuredMs = aligned.frames.reduce((sum, frame) => sum + frame.interval, 0);
      const measurableFps = window.fps - (repeatedTimestamps * 1000) / measuredMs;
      expect(recordingSummary(aligned).fps).toBeCloseTo(measurableFps, 7);
      expect(
        Math.abs((analyzeRecording(aligned).summary.fps ?? 0) - measurableFps),
      ).toBeLessThanOrEqual(0.005001);
      const live = readLive({
        diagnostics: {
          ...recording,
          frames: recording.frames.filter((frame) => frame.id <= window.lastId),
          recording: false,
        },
        gpu: null,
      });
      if (mode === "controlled" && window.lastId < 175) {
        expect(live.fps.status).toBe("measured");
        if (live.fps.status === "measured")
          expect(Math.abs(live.fps.value - window.fps)).toBeLessThanOrEqual(1.000001);
      }
      return { ...window, repeatedTimestamps, measurableFps, liveFps: live.fps };
    });
    const sortedErrors = workErrors.toSorted((a, b) => a - b);
    const p95WorkErrorMs = sortedErrors[Math.ceil(sortedErrors.length * 0.95) - 1] ?? Infinity;
    expect(p95WorkErrorMs).toBeLessThanOrEqual(2);
    if (mode === "controlled") {
      expect(result.rows.some((row) => row.workMs === 0)).toBe(true);
      expect(analyzeRecording(recording).summary.frameMs?.worst).toBe(80);
      expect(fpsChecks.some((window) => window.repeatedTimestamps === 3)).toBe(true);
    }
    expect(errors).toEqual([]);
    await info.attach(`Stats.js ${mode}`, {
      body: JSON.stringify(
        { packageVersion: "0.17.0", mode, p95WorkErrorMs, fpsChecks, ...result },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}
