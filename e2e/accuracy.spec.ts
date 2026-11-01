import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import type { PerformanceRecording } from "../src/core/recording-types.ts";

import { inspectFrame, intervalUnion } from "../src/core/inspection.ts";

import { serveFixtures } from "./fixture.ts";

interface SceneFrame {
  id: number;
  at: number;
  start: number;
  end: number;
  workStart: number;
  workEnd: number;
  work: number;
  /** The planted sort's own time, read inside its scope; 0 on frames without one. */
  spikeMs: number;
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

// One frame at 60 Hz, the scene's budget.
const frameMs = 1000 / 60;

// The planted spikes' scope time beyond the sorts they wrap: two clock reads each, plus any
// stall between them. Double counting would add a whole sort, about 90 ms.
const spikeOverheadMs = 1;

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

/** Opens the scene, ready to run. */
async function openScene(page: Page) {
  await serveFixtures(page);

  await page.goto("/__fixture/load.html");

  await page.waitForFunction(() => window.accuracy !== undefined);
}

/** jank.js's numbers for each frame beside the scene's own clock readings of the same work. */
function measure(run: SceneRun) {
  const recorded = new Map(
    run.recording.frames.map((frame) => [frame.id, frame]),
  );

  const rows = run.frames.map((frame, i) => {
    const jank = recorded.get(frame.id);

    if (!jank) throw new Error(`jank.js recorded no frame ${frame.id}`);

    const next = run.frames[i + 1];

    return {
      ...frame,
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
    };
  });

  /** Work from any callback that ran between two page times. */
  const workBetween = (from: number, to: number) =>
    sum(
      rows.map((row) =>
        Math.max(0, Math.min(row.workEnd, to) - Math.max(row.workStart, from)),
      ),
    );

  // jank.js's frame model: frame i spans its rAF timestamp to the next one. Scope time
  // that runs past the next timestamp belongs to the next frame, so a frame's scopes are
  // whatever work ran inside its window, whichever callback did it. The first frame is left
  // out: its window can also hold the tail of the scene's last callback before the run, which
  // jank.js rightly counts but the scene does not log.
  const scopesVsWork = rows
    .map(
      (row, i) =>
        row.jankScopesMs - workBetween(row.at, rows[i + 1]?.at ?? run.stopAt),
    )
    .slice(1);

  // The spike sort's CPU row over the whole recording, so a sort carried into the next frame
  // still counts once.
  const spikeRowMs = sum(
    run.recording.frames.map(
      (frame) =>
        inspectFrame(run.recording, frame.id)!.systemTimings.find(
          (system) => system.id === "spike",
        )?.inclusiveMs ?? 0,
    ),
  );

  return {
    rows,
    intervalVsHostMs: spread(
      rows.slice(0, -1).map((row) => row.jankIntervalMs - row.hostIntervalMs!),
    ),
    scopesVsWork,
    scopesVsModelMs: spread(scopesVsWork),
    spikes: rows.filter((row) => row.spikeMs > 0).length,
    spikeMs: sum(rows.map((row) => row.spikeMs)),
    spikeRowMs,
    // The page's clock step, as jank.js measured it when the recording started. No step seen
    // in its reads means a coarse clock, such as WebKit's whole milliseconds.
    tickMs:
      run.recording.metadata.environment.cpuTimer.estimatedResolutionMs ?? 1,
  };
}

// What: a scene doing real work (a particle simulation, a Canvas 2D draw of every particle
// and three planted sorts) runs while jank.js records it, and every number jank.js reports is
// checked against the scene's own clock readings of the same work.
// Why: these relationships are exact, so they gate in every browser, with allowances in clock
// ticks rather than guessed noise. They need nothing from Chrome or another tool, so a
// browser update or a meter's new version cannot fail them.
test("jank.js frame timings hold to the scene's own clock", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await openScene(page);

  const measured = measure(await page.evaluate(() => window.accuracy.run()));

  const { rows, tickMs } = measured;

  // The scene must actually have loaded the machine: frames over budget and planted spikes.
  expect(rows.some((row) => row.work > frameMs)).toBe(true);
  expect(measured.spikes).toBe(3);

  // Each frame interval is exactly the host's rAF step, so over the run they add up to it.
  expect(measured.intervalVsHostMs.max).toBeLessThan(1e-6);

  // Planted work: each sort, timed inside its own scope, shows in full in the spike row, and
  // only once.
  expect(measured.spikeRowMs).toBeGreaterThanOrEqual(measured.spikeMs - 1e-6);
  expect(measured.spikeRowMs - measured.spikeMs).toBeLessThan(
    measured.spikes * spikeOverheadMs,
  );

  // Each frame's scope time is the work that ran inside its window, so time carried across a
  // frame boundary is neither lost nor double-counted. Scopes never exceed that work (two clock
  // ticks of allowance), which rules out double counting. They fall short only by the scene's
  // own code between one scope and the next, which no scope includes; a stall there can
  // lengthen one frame's gap, but lost carried time would show on the 40% of frames that carry
  // the previous callback's tail, so the shortfall is bounded at the 95th percentile.
  expect(Math.max(...measured.scopesVsWork)).toBeLessThan(
    Math.max(0.01, 2 * tickMs),
  );
  expect(measured.scopesVsModelMs.p95).toBeLessThan(0.1 + 2 * tickMs);
});

// What: the same scene, timed at once by jank.js, Chrome's own trace (the data behind the
// DevTools Performance panel), the long-animation-frame API, and two widely used meters,
// stats.js and stats-gl.
// Why: agreement with the browser's instruments and peer tools is evidence, not a rule; they
// time different windows and change between versions. The run's differences are saved and
// shown in the CI summary, and the build fails only on disagreement too large to be noise.
test("jank.js agrees with Chrome's trace, long-animation-frame timing, stats.js and stats-gl", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Chrome's trace and long-animation-frame timing exist only in Chromium",
  );
  test.setTimeout(60_000);

  await openScene(page);

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

  /** The trace callback that starts nearest a page time. */
  const nearest = (time: number) =>
    callbacks.reduce((best, callback) =>
      Math.abs(callback.start - time) < Math.abs(best.start - time)
        ? callback
        : best,
    );

  const measured = measure(run);

  const rows = measured.rows.map((row, i) => {
    const trace = nearest(row.start);

    return {
      ...row,
      // How far the matched trace callback starts from the scene's own callback start.
      matchMs: trace.start - row.start,
      traceStart: trace.start,
      traceCallbackMs: trace.duration,
      statsJsMs: run.statsJs.MS[i]?.value ?? null,
      statsGlMs: row.statsGl.cpu,
      statsGlFps: row.statsGl.fps,
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
    intervalVsHostMs: measured.intervalVsHostMs,
    intervalTotalVsTraceMs:
      sum(intervals.map((row) => row.jankIntervalMs)) -
      (last.traceStart - first.traceStart),
    scopesVsModelMs: measured.scopesVsModelMs,
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

  // Long frames to compare: the scene's three spikes.
  expect(longFrames.length).toBeGreaterThanOrEqual(3);

  // Every frame matched its own trace callback, not a neighbour 16 ms away. A quarter of a
  // frame allows a busy runner's scheduling delay while still ruling out the wrong callback.
  expect(report.traceMatchMs.max).toBeLessThan(frameMs / 4);

  // Frame rates agree with both meters within two frames. The meters count a frame when its
  // callback ends and jank.js when its rAF timestamp falls. Under load Chrome's timestamps
  // can trail the callbacks by more than a frame, so up to two frames can sit on the other
  // side of a window's edge.
  for (const pair of statsJsFps)
    expect(Math.abs(pair.statsJs - pair.jank)).toBeLessThanOrEqual(
      2 * pair.oneFrame + 1e-9,
    );

  expect(report.statsGlFps.max).toBeLessThanOrEqual(2);

  // Each long frame: the browser's own duration, Chrome's trace and jank.js's cost for it agree
  // within a frame.
  for (const frame of longFrames) {
    expect(frame.traceMs).not.toBeNull();
    expect(Math.abs(frame.loafMs - frame.traceMs!)).toBeLessThan(frameMs);
    expect(Math.abs(frame.loafMs - frame.jankCostMs!)).toBeLessThan(frameMs);
  }
});
