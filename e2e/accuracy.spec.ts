import { mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { PerformanceRecording } from "../src/core/recording-types.ts";

import { intervalUnion } from "../src/core/inspection.ts";

import { serveFixtures } from "./fixture.ts";

interface SceneFrame {
  id: number;
  at: number;
  start: number;
  end: number;
  workStart: number;
  workEnd: number;
  work: number;
  statsGl: { fps: number; cpu: number };
}

interface Reading {
  at: number;
  value: number;
}

interface SceneRun {
  markStart: number;
  /** rAF timestamp of the frame after the window; the last frame's late scopes go to it. */
  stopAt: number;
  isolated: boolean;
  frames: SceneFrame[];
  recording: PerformanceRecording;
  statsJs: { FPS: Reading[]; MS: Reading[] };
  loaf: {
    startTime: number;
    duration: number;
    scripts: { invoker: string; startTime: number; duration: number }[];
  }[];
}

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
}

declare global {
  interface Window {
    accuracy: {
      sizes: { light: number; heavy: number };
      run(options?: object): Promise<SceneRun>;
    };
  }
}

const microsecondsPerMs = 1000;

/** Sum of a list of numbers. */
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Summary of absolute differences, for the report. */
const spread = (values: number[]) => {
  const sorted = values.map(Math.abs).toSorted((a, b) => a - b);

  return {
    median: sorted[sorted.length >> 1] ?? 0,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Chrome's trace and long-animation-frame timing exist only in Chromium",
);

// What: a scene doing real work (a particle simulation, a Canvas 2D draw of every particle
// and occasional large sorts) runs while four independent observers time the same frames:
// jank.js, Chrome's own trace (the data behind the DevTools Performance panel), the
// long-animation-frame API, and two widely used meters, stats.js and stats-gl.
// Why: unit tests prove the arithmetic on scripted clocks. This proves the numbers jank.js
// reports on real, unpredictable load match what the browser itself measured, within a
// stated tolerance, and that jank.js accounts for its own overhead rather than hiding it.
test("jank.js frame timings agree with Chrome's trace, long-animation-frame timing, stats.js and stats-gl", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  await serveFixtures(page);

  await page.goto("/__fixture/load.html");

  await page.waitForFunction(() => window.accuracy !== undefined);

  await browser.startTracing(page, {
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "blink.user_timing",
    ],
  });

  const run = await page.evaluate(() => window.accuracy.run());

  const traceText = (await browser.stopTracing()).toString();

  const { traceEvents }: { traceEvents: TraceEvent[] } = JSON.parse(traceText);

  // The start mark ties Chrome's trace clock to the page's performance.now() clock.
  const mark = traceEvents.find((event) => event.name === "accuracy:start")!;

  const toPage = (ts: number) =>
    (ts - mark.ts) / microsecondsPerMs + run.markStart;

  const callbacks = traceEvents
    .filter(
      (event) =>
        event.name === "FireAnimationFrame" &&
        event.pid === mark.pid &&
        event.tid === mark.tid,
    )
    .map((event) => ({
      start: toPage(event.ts),
      duration: (event.dur ?? 0) / microsecondsPerMs,
    }));

  const recorded = new Map(
    run.recording.frames.map((frame) => [frame.id, frame]),
  );

  /** The trace callback that starts nearest a page time. */
  const nearest = (time: number) =>
    callbacks.reduce((best, callback) =>
      Math.abs(callback.start - time) < Math.abs(best.start - time)
        ? callback
        : best,
    );

  const rows = run.frames.map((frame, i) => {
    const jank = recorded.get(frame.id)!;

    const trace = nearest(frame.start);

    const next = run.frames[i + 1];

    return {
      id: frame.id,
      at: frame.at,
      start: frame.start,
      end: frame.end,
      workStart: frame.workStart,
      workEnd: frame.workEnd,
      // How far the matched trace callback starts from the scene's own callback start.
      matchMs: trace.start - frame.start,
      traceStart: trace.start,
      traceCallbackMs: trace.duration,
      jankWorkMs: jank.update + jank.render,
      jankCostMs:
        jank.update +
        jank.render +
        jank.overhead.collectionMs +
        jank.overhead.refreshMs,
      jankRefreshMs: jank.overhead.refreshMs,
      jankIntervalMs: jank.interval,
      jankScopesMs: intervalUnion(jank.scopes),
      hostIntervalMs: next ? next.at - frame.at : null,
      statsJsMs: run.statsJs.MS[i]?.value ?? null,
      statsGlMs: frame.statsGl.cpu,
      statsGlFps: frame.statsGl.fps,
    };
  });

  const first = rows.at(0),
    last = rows.at(-1);

  if (!first || !last) throw new Error("The scene measured no frames");

  /** jank.js's frame-rate rule over a window: frames whose rAF time falls in it, per second. */
  const jankFps = (from: number, to: number) =>
    (rows.filter((row) => row.at > from && row.at <= to).length * 1000) /
    (to - from);

  // Each stats.js FPS reading covers the time since its previous reading. The first one
  // began before the measured run, so it has no jank.js frames to compare with.
  const statsJsFps = run.statsJs.FPS.slice(1).map((reading, i) => {
    const from = run.statsJs.FPS.at(i)!.at;

    return {
      statsJs: reading.value,
      jank: jankFps(from, reading.at),
      // One frame in this window, in frames per second.
      oneFrame: 1000 / (reading.at - from),
    };
  });

  // stats-gl counts its updates in the last second; skip the run's first second for the same
  // reason.
  const statsGlFps = rows
    .filter((row) => row.end - 1000 >= first.at)
    .map((row) => ({
      statsGl: row.statsGlFps,
      jank: jankFps(row.end - 1000, row.end),
    }));

  // Long animation frames: the browser's own timing of each rAF callback over 50 ms.
  const longFrames = run.loaf.flatMap((entry) =>
    entry.scripts
      .filter((script) => script.invoker === "user-callback")
      .map((script) => {
        const row = rows.find(
          (candidate) => Math.abs(candidate.start - script.startTime) < 1,
        );

        return {
          loafMs: script.duration,
          traceMs: row?.traceCallbackMs ?? null,
          jankCostMs: row?.jankCostMs ?? null,
        };
      }),
  );

  const intervals = rows.slice(0, -1);

  /** Work from any callback that ran between two page times. */
  const workBetween = (from: number, to: number) =>
    sum(
      rows.map((row) =>
        Math.max(0, Math.min(row.workEnd, to) - Math.max(row.workStart, from)),
      ),
    );

  // jank.js's frame model: frame i spans its rAF timestamp to the next one. Scope time
  // that runs past the next timestamp belongs to the next frame, so a frame's scopes are
  // whatever work ran inside its window, whichever callback did it.
  const modelScopes = (i: number) =>
    workBetween(rows.at(i)!.at, rows.at(i + 1)?.at ?? run.stopAt);

  const report = {
    environment: { isolated: run.isolated, browser: browser.version() },
    sizes: await page.evaluate(() => window.accuracy.sizes),
    frames: rows.length,
    traceMatchMs: spread(rows.map((row) => row.matchMs)),
    unaccountedMs: spread(
      rows.map((row) => row.traceCallbackMs - row.jankCostMs),
    ),
    statsJsMsVsJank: spread(
      rows.map((row) => (row.statsJsMs ?? row.jankWorkMs) - row.jankWorkMs),
    ),
    statsGlMsVsJank: spread(rows.map((row) => row.statsGlMs - row.jankWorkMs)),
    intervalVsHostMs: spread(
      intervals.map((row) => row.jankIntervalMs - row.hostIntervalMs!),
    ),
    intervalTotalVsTraceMs:
      sum(intervals.map((row) => row.jankIntervalMs)) -
      (last.traceStart - first.traceStart),
    scopesVsModelMs: spread(
      rows.map((row, i) => row.jankScopesMs - modelScopes(i)),
    ),
    statsJsFps,
    statsGlFps: spread(statsGlFps.map((pair) => pair.statsGl - pair.jank)),
    longFrames,
    rows,
  };

  await mkdir("artifacts/accuracy", { recursive: true });

  await writeFile("artifacts/accuracy/trace.json", traceText);

  await writeFile(
    "artifacts/accuracy/report.json",
    JSON.stringify(report, null, 2),
  );

  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));

  // The scene must actually have loaded the machine: frames over budget and spikes.
  expect(rows.some((row) => row.jankWorkMs > 16.7)).toBe(true);
  expect(longFrames.length).toBeGreaterThanOrEqual(3);

  // Every frame matched its own trace callback, not a neighbour 16 ms away. This compares the
  // scene's clock with Chrome's, not jank.js; a quarter of a frame allows the scheduling delay
  // of a busy CI runner (0.52 ms seen on macOS) while still ruling out the wrong callback.
  expect(report.traceMatchMs.max).toBeLessThan(4);

  // jank.js never reports more CPU than Chrome measured for the callback (within two timer
  // ticks), and what it leaves out (the two other meters and the scene's bookkeeping) stays
  // small. The upper bound adds only windows that cannot overlap: the host's update and render
  // and the panel refresh. Scope begin and end run inside the host's own update and render
  // timing, so adding their collection cost too would count that time twice.
  expect(
    Math.min(
      ...rows.map(
        (row) => row.traceCallbackMs - row.jankWorkMs - row.jankRefreshMs,
      ),
    ),
  ).toBeGreaterThan(-0.05);
  expect(report.unaccountedMs.p95).toBeLessThan(1);

  // stats.js and stats-gl start before the work jank.js times and stop after it, so they never
  // read less (two timer ticks of allowance). They read more only by their own begin and end
  // calls; a stall in those can lengthen one frame, so the excess is bounded at the 95th
  // percentile.
  for (const meter of [
    (row: (typeof rows)[number]) => row.statsJsMs ?? row.jankWorkMs,
    (row: (typeof rows)[number]) => row.statsGlMs,
  ])
    expect(
      Math.min(...rows.map((row) => meter(row) - row.jankWorkMs)),
    ).toBeGreaterThan(-0.01);

  expect(report.statsJsMsVsJank.p95).toBeLessThan(0.1);
  expect(report.statsGlMsVsJank.p95).toBeLessThan(0.1);

  // Frame intervals are exactly the host's rAF timestamps, and over the run they add up to
  // the trace's callback span, give or take one frame of scheduling delay at each end.
  expect(report.intervalVsHostMs.max).toBeLessThan(1e-6);
  expect(Math.abs(report.intervalTotalVsTraceMs)).toBeLessThan(34);

  // Each frame's scope time is exactly the work that ran inside its window, so time carried
  // across a frame boundary is neither lost nor double-counted. Scopes never exceed that work
  // (two timer ticks of allowance), which rules out double counting. They fall short only by
  // the scene's own code between one scope and the next, which no scope includes; a stall
  // there can lengthen one frame's gap, but lost carried time would show on the 40% of frames
  // that carry the previous callback's tail, so the shortfall is bounded at the 95th percentile.
  expect(
    Math.max(...rows.map((row, i) => row.jankScopesMs - modelScopes(i))),
  ).toBeLessThan(0.01);
  expect(report.scopesVsModelMs.p95).toBeLessThan(0.1);

  // Frame rates agree with both meters within two frames. The meters count a frame when its
  // callback ends and jank.js when its rAF timestamp falls. Under load Chrome's timestamps
  // can trail the callbacks by more than a frame, so up to two frames can sit on the other
  // side of a window's edge.
  for (const pair of statsJsFps)
    expect(Math.abs(pair.statsJs - pair.jank)).toBeLessThanOrEqual(
      2 * pair.oneFrame + 1e-9,
    );

  expect(report.statsGlFps.max).toBeLessThanOrEqual(2);

  // Long frames: the browser's own duration for each rAF callback matches the trace, and
  // jank.js's cost for that frame matches both.
  for (const frame of longFrames) {
    expect(frame.traceMs).not.toBeNull();
    expect(Math.abs(frame.loafMs - frame.traceMs!)).toBeLessThan(1);
    expect(Math.abs(frame.loafMs - frame.jankCostMs!)).toBeLessThan(2);
  }
});
