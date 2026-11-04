import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { inspectFrame, intervalUnion } from "../src/core/inspection.ts";
import type { PerformanceRecording } from "../src/core/recording-types.ts";
import { dist, origin, servePackage } from "./serve-package.ts";

interface SceneFrame {
  id: number;
  at: number;
  workStart: number;
  workEnd: number;
  work: number;
  /** The planted sort's own time, read inside its scope; 0 on frames without one. */
  spikeMs: number;
}

interface SceneRun {
  /** Animation timestamp of the frame after the window; the last frame's late scopes go to it. */
  stopAt: number;
  frames: SceneFrame[];
  recording: PerformanceRecording;
}

// One frame at 60 Hz, the scene's budget.
const frameMs = 1000 / 60;

// The planted spikes' scope time beyond the sorts they wrap: two clock reads each, plus any
// stall between them. Double counting would add a whole sort, about 90 ms.
const spikeOverheadMs = 1;

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const p95 = (values: number[]) =>
  values.map(Math.abs).toSorted((a, b) => a - b)[Math.floor((values.length - 1) * 0.95)] ?? 0;

/**
 * Every frame does real work: a particle simulation, a Canvas 2D draw of every particle and three
 * planted sorts. Nothing is a timed busy-wait, so no one knows a frame's cost in advance.
 * Playwright serializes this into the browser, so it holds everything it uses.
 */
async function runScene(): Promise<SceneRun> {
  const warmupFrames = 10;
  const lightFrames = 120;
  const heavyFrames = 90;
  const spikeEvery = 30;
  const maxParticles = 400_000;
  const [{ createDiagnostics }, { createPerformancePanel }] = await Promise.all(
    ["/index.js", "/panel.js"].map((entry) => import(entry)),
  );
  const canvas = document.querySelector("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) throw new Error("No canvas");
  const positions = new Float32Array(maxParticles * 2).map(() => Math.random());
  const velocities = new Float32Array(maxParticles * 2).map(() => (Math.random() - 0.5) * 0.01);
  let spikeData = new Float64Array(0);

  const simulate = (count: number) => {
    for (let i = 0; i < count * 2; i += 2) {
      const dx = 0.5 - (positions[i] as number);
      const dy = 0.5 - (positions[i + 1] as number);
      const pull = 0.0005 / (Math.sqrt(dx * dx + dy * dy) + 0.05);
      const vx = ((velocities[i] as number) + dx * pull) * 0.999;
      const vy = ((velocities[i + 1] as number) + dy * pull) * 0.999;
      const x = (positions[i] as number) + vx;
      const y = (positions[i + 1] as number) + vy;
      velocities[i] = x < 0 || x > 1 ? -vx : vx;
      velocities[i + 1] = y < 0 || y > 1 ? -vy : vy;
      positions[i] = x;
      positions[i + 1] = y;
    }
  };
  const draw = (count: number) => {
    context.fillStyle = "#141414";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#7dd3fc";
    for (let i = 0; i < count * 2; i += 2)
      context.fillRect(
        (positions[i] as number) * canvas.width,
        (positions[i + 1] as number) * canvas.height,
        2,
        2,
      );
  };
  const spike = () => {
    for (let i = 0; i < spikeData.length; i++) spikeData[i] = Math.random();
    spikeData.sort();
  };
  /** Median of a few timed runs of some work, in milliseconds. */
  const timed = (work: () => void, runs = 5) => {
    const times = Array.from({ length: runs }, () => {
      const start = performance.now();
      work();
      return performance.now() - start;
    });
    return times.toSorted((a, b) => a - b)[runs >> 1] as number;
  };

  // Sizes the work for this machine, so light frames fit the budget, heavy frames don't, and
  // spikes are long frames everywhere. The work itself stays real.
  const sample = 20_000;
  const perParticle =
    timed(() => {
      simulate(sample);
      draw(sample);
    }) / sample;
  spikeData = new Float64Array(200_000);
  const perElement = timed(spike, 3) / spikeData.length;
  spikeData = new Float64Array(Math.min(8_000_000, Math.round(90 / perElement)));
  const light = Math.min(maxParticles, Math.round(4 / perParticle));
  const heavy = Math.min(maxParticles, Math.round(30 / perParticle));

  const monitor = createDiagnostics();
  const panel = createPerformancePanel({ shell: document.body, monitor });
  const simulation = monitor.register("simulation", "Simulation");
  const drawing = monitor.register("drawing", "Canvas drawing");
  const sorting = monitor.register("spike", "Sort");
  const plan = [
    ...Array.from({ length: lightFrames }, () => ({ count: light, spike: false })),
    ...Array.from({ length: heavyFrames }, (_, i) => ({
      count: heavy,
      spike: i % spikeEvery === spikeEvery >> 1,
    })),
  ];
  const frames: SceneFrame[] = [];

  return new Promise((done, fail) => {
    let warmup = warmupFrames;
    let stopAfter = -1;
    const frame = (at: number) => {
      try {
        const id: number = monitor.beginFrame(at);
        // beginFrame sealed the previous frame, so the measured window ends here.
        if (id === stopAfter) {
          panel.capture.stopAndSave();
          const { saved, error } = panel.capture.getSnapshot();
          if (error) throw new Error(error);
          const { recording } = saved[0];
          panel.destroy();
          monitor.dispose();
          done({ stopAt: at, frames, recording });
          return;
        }
        panel.refresh(at);
        const step = warmup > 0 ? { count: light, spike: false } : plan.shift();
        if (!step) throw new Error("The plan ran out before the window closed.");
        const workStart = performance.now();
        let token = simulation.begin();
        simulate(step.count);
        simulation.end(token);
        const update = performance.now() - workStart;
        const renderStart = performance.now();
        token = drawing.begin();
        draw(step.count);
        drawing.end(token);
        let spikeMs = 0;
        if (step.spike) {
          token = sorting.begin();
          const spikeStart = performance.now();
          spike();
          spikeMs = performance.now() - spikeStart;
          sorting.end(token);
        }
        const workEnd = performance.now();
        const render = workEnd - renderStart;
        monitor.endFrame(update, render);
        if (warmup > 0) {
          // Recording starts between frames, so every logged frame below is in it.
          if (--warmup === 0) panel.capture.start();
        } else {
          frames.push({ id, at, workStart, workEnd, work: update + render, spikeMs });
          if (!plan.length) stopAfter = id + 1;
        }
        requestAnimationFrame(frame);
      } catch (error) {
        fail(error);
      }
    };
    requestAnimationFrame(frame);
  });
}

test.skip(!existsSync(join(dist, "panel.js")), "Run pnpm build:package first.");

// What: a scene doing real work runs while jank.js records it through the panel, and every number
// jank.js reports is checked against the scene's own clock readings of the same work.
// Why: timing is what this tool is for. These relationships are exact, so they gate in every
// browser, with allowances in clock ticks rather than guessed noise, and they need nothing from
// Chrome or another tool, so a browser update or a meter's new version cannot fail them.
test("jank.js frame timings hold to the scene's own clock", async ({ page }) => {
  test.setTimeout(120_000);
  // Isolation gives the finest timer a browser allows, which tightens the allowances below.
  await servePackage(
    page,
    '<!doctype html><html lang="en"><title>Accuracy scene</title><body style="margin:0"><canvas width="1280" height="720"></canvas></body></html>',
    {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  );
  await page.goto(`${origin}/`);
  const run = await page.evaluate(runScene);
  const recorded = new Map(run.recording.frames.map((frame) => [frame.id, frame]));
  const rows = run.frames.map((frame, i) => {
    const jank = recorded.get(frame.id);
    if (!jank) throw new Error(`jank.js recorded no frame ${frame.id}`);
    const next = run.frames[i + 1];
    return {
      ...frame,
      jankWorkMs: jank.update + jank.render,
      jankIntervalMs: jank.interval,
      jankScopesMs: intervalUnion(jank.scopes),
      hostIntervalMs: next ? next.at - frame.at : null,
    };
  });
  // The page's clock step, as jank.js measured it when the recording started. No step seen in its
  // reads means a coarse clock, such as WebKit's whole milliseconds.
  const tickMs = run.recording.metadata.environment.cpuTimer.estimatedResolutionMs ?? 1;

  // The scene must actually have loaded the machine: frames over budget and planted spikes.
  expect(rows.some((row) => row.work > frameMs)).toBe(true);
  const spikes = rows.filter((row) => row.spikeMs > 0);
  expect(spikes).toHaveLength(3);

  // Each frame interval is exactly the host's animation step.
  for (const row of rows)
    if (row.hostIntervalMs !== null)
      expect(Math.abs(row.jankIntervalMs - row.hostIntervalMs)).toBeLessThan(1e-6);

  // The exact update and render window the host reported.
  for (const row of rows)
    expect(Math.abs(row.jankWorkMs - row.work)).toBeLessThan(0.01 + 2 * tickMs);

  // Each sort, timed inside its own scope, shows in full in the spike row, and only once. Summed
  // over the recording, so a sort carried into the next frame still counts once.
  const spikeMs = sum(spikes.map((row) => row.spikeMs));
  const spikeRowMs = sum(
    run.recording.frames.map(
      (frame) =>
        inspectFrame(run.recording, frame.id)?.systemTimings.find((system) => system.id === "spike")
          ?.inclusiveMs ?? 0,
    ),
  );
  expect(spikeRowMs).toBeGreaterThanOrEqual(spikeMs - 2 * tickMs);
  expect(spikeRowMs - spikeMs).toBeLessThan(spikes.length * spikeOverheadMs + 2 * tickMs);

  // jank.js's frame model: frame i spans its animation timestamp to the next one, so its scopes
  // are whatever work ran inside that window, whichever callback did it. Scopes never exceed that
  // work, which rules out double counting. They fall short only by the scene's own code between
  // scopes, so lost carried time would show at the 95th percentile. The first frame is left out:
  // its window can hold the tail of the callback before the run, which the scene does not log.
  const workBetween = (from: number, to: number) =>
    sum(rows.map((row) => Math.max(0, Math.min(row.workEnd, to) - Math.max(row.workStart, from))));
  const scopesVsWork = rows
    .map((row, i) => row.jankScopesMs - workBetween(row.at, rows[i + 1]?.at ?? run.stopAt))
    .slice(1);
  expect(Math.max(...scopesVsWork)).toBeLessThan(Math.max(0.01, 2 * tickMs));
  expect(p95(scopesVsWork)).toBeLessThan(0.1 + 2 * tickMs);
});
