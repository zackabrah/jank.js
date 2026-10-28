import { execFile } from "node:child_process";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join } from "node:path";

import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { fixtureFile, fixtureHeaders } from "../e2e/fixtures/files.mjs";

// Playwright answers every request itself, so any origin works and no server runs.
const origin = "http://jank.capture";

const out = "docs/readme";

/** Device pixels per CSS pixel: sharp on high-density screens. */
const scale = 2;

/** Room for the tallest panel before the window shrinks to fit it. */
const roomy = { width: 1440, height: 1600 };

/** Time for frames to flow after each step, as the browser suite waits. */
const settleMs = 400;

/** The fixture spikes, as the browser suite injects them. */
const spikeMs = 40;

const captureSpikeMs = 45;

/** The annotated view: callout column width, the gap its leaders cross, line height and spacing. */
const annotation = { column: 250, gap: 44, line: 16, spacing: 12, arrow: 5 };

/** What each part of the LIVE view shows, written beside it. */
const callouts = [
  [
    '[data-k="fps"]',
    "frames in the last second, beside the slowest and fastest second",
  ],
  [
    '[data-k="worst"]',
    "the slowest frame and when it came. ▲ means over budget",
  ],
  ['[data-k="graph"]', "each frame against the budget line, with events below"],
  ['[data-k="cpu"]', "time in the systems you named. the rest is unattributed"],
  ['[data-k="gpu"]', "gpu time per render pass, from timer queries"],
  ['[data-k="counters"]', "counts your systems report, by source"],
  [
    '[data-action="freeze"]',
    "freeze the display, record, export for the offline viewer",
  ],
  [
    '[data-k="oh-collect"]',
    "what jank.js costs: collecting frames and redrawing this panel",
  ],
  ['[data-k="honest-cpu"]', "timer precision here, and the jank.js build"],
];

/** The running GIF: frames per second, time before the spike and after the event. */
const gif = { fps: 20, leadMs: 600, tailMs: 2400 };

const run = promisify(execFile);

const msPerSecond = 1000;

// Checked first, so a missing encoder fails before the browser work.
await run("ffmpeg", ["-version"]).catch(() => {
  throw new Error(
    "pnpm docs:captures needs ffmpeg on PATH for the running GIF.",
  );
});

const browser = await chromium.launch();

// Device mode: the window takes any exact size, and still images skip the graph's glide.
const context = await browser.newContext({
  viewport: roomy,
  deviceScaleFactor: scale,
  isMobile: true,
  reducedMotion: "reduce",
});

const page = await context.newPage();

await page.route(`${origin}/__fixture/**`, async (route) => {
  const name = new URL(route.request().url()).pathname.split("/__fixture/")[1];

  const file = fixtureFile(name);

  await route.fulfill({
    body: await readFile(file),
    headers: fixtureHeaders(name, file),
  });
});

// Every view starts at its own size rather than the size the last one left behind.
await page.addInitScript(() => localStorage.clear());

/** Opens the fixture game and waits for its loading stages. */
async function open(query = "") {
  await page.goto(`${origin}/__fixture/index.html${query}`);

  await page.evaluate(() => window.fixture.loaded);

  // A plain frame around the panel: the page's grey without the scene's stars.
  await page.addStyleTag({ content: "main > canvas { visibility: hidden; }" });
}

/** Waits for some frames to flow. */
const settle = () => page.waitForTimeout(settleMs);

/** Shrinks the window to the panel plus its inset on every side, and room on the left. */
async function frame(left = 0) {
  const { width, height, inset } = await page
    .locator(".jank")
    .evaluate((panel) => {
      const box = panel.getBoundingClientRect();

      return {
        width: box.width,
        height: box.height,
        inset: parseFloat(
          getComputedStyle(panel).getPropertyValue("--jank-inset"),
        ),
      };
    });

  await page.setViewportSize({
    width: Math.ceil(left + width + 2 * inset),
    height: Math.ceil(height + 2 * inset),
  });

  await settle();
}

/** Frames the panel, then saves the page. */
async function capture(name) {
  await frame();

  await page.screenshot({ path: `${out}/${name}.png` });

  await page.setViewportSize(roomy);

  console.log(`${out}/${name}.png`);
}

/** Frames the panel with callouts on its left, each with a leader to what it explains. */
async function annotate(name) {
  await frame(annotation.column + annotation.gap);

  await page.evaluate(
    ({ notes, column, gap, line, spacing, arrow }) => {
      const svgns = "http://www.w3.org/2000/svg";

      const panel = document.querySelector(".jank").getBoundingClientRect();

      // The tool's own tokens: the panel stylesheet defines them on .jank-viewer too.
      const layer = document.createElement("div");

      layer.className = "jank-viewer";
      layer.dataset["annotations"] = "";
      layer.style.cssText = `position: fixed; inset: 0; z-index: 31; pointer-events: none; color: var(--jank-muted); font: 400 var(--jank-size-body) / ${line}px var(--jank-font);`;

      const svg = document.createElementNS(svgns, "svg");

      svg.style.cssText =
        "position: absolute; inset: 0; width: 100%; height: 100%; fill: none; stroke: var(--jank-faint);";

      layer.append(svg);

      document.body.append(layer);

      const elbow = Math.round(panel.left - gap / 2);

      let below = panel.top;

      for (const [selector, text] of notes) {
        const box = document
          .querySelector(`.jank ${selector}`)
          .getBoundingClientRect();

        // Whole pixels, so the 1 px leaders stay sharp.
        const target = Math.round(box.top + box.height / 2);

        const label = document.createElement("p");

        label.textContent = text;
        label.style.cssText = `position: absolute; margin: 0; left: ${panel.left - gap - column}px; width: ${column}px; text-align: right;`;

        layer.append(label);

        // At its target's height, or just below the callout above.
        const top = Math.round(Math.max(target - line / 2, below));

        label.style.top = `${top}px`;

        below = top + label.offsetHeight + spacing;

        const y = top + line / 2;

        const leader = document.createElementNS(svgns, "polyline");

        leader.setAttribute(
          "points",
          `${panel.left - gap + arrow},${y} ${elbow},${y} ${elbow},${target} ${panel.left - arrow},${target}`,
        );

        const head = document.createElementNS(svgns, "path");

        head.setAttribute(
          "d",
          `M${panel.left - arrow},${target - arrow / 2}L${panel.left},${target}L${panel.left - arrow},${target + arrow / 2}Z`,
        );
        head.style.cssText = "fill: var(--jank-faint); stroke: none;";

        svg.append(leader, head);
      }
    },
    { notes: callouts, ...annotation },
  );

  await page.screenshot({ path: `${out}/${name}.png` });

  await page.evaluate(() =>
    document.querySelector("[data-annotations]").remove(),
  );

  await page.setViewportSize(roomy);

  console.log(`${out}/${name}.png`);
}

/** Films the framed panel while `steps` run, then encodes a looping GIF with ffmpeg. */
async function film(name, steps) {
  await frame();

  const shots = [];

  let filming = true;

  const done = steps().finally(() => {
    filming = false;
  });

  // Screenshots, not Chrome's screencast, which sends CSS pixels. Each waits for the last,
  // and the steps clear the flag while the loop awaits.
  /* oxlint-disable no-await-in-loop, no-unmodified-loop-condition */
  while (filming)
    shots.push({
      data: await page.screenshot(),
      at: performance.now() / msPerSecond,
    });
  /* oxlint-enable no-await-in-loop, no-unmodified-loop-condition */

  await done;

  const dir = await mkdtemp(join(tmpdir(), "jank-capture-"));

  // Each frame shows until the next arrived; the last for one GIF frame.
  const list = shots.flatMap((shot, i) => [
    `file '${join(dir, `${i}.png`)}'`,
    `duration ${(shots[i + 1]?.at ?? shot.at + 1 / gif.fps) - shot.at}`,
  ]);

  await Promise.all(
    shots.map((shot, i) => writeFile(join(dir, `${i}.png`), shot.data)),
  );

  await writeFile(join(dir, "frames.txt"), list.join("\n"));

  // One palette for the whole loop, and no dithering: flat panel colours stay flat.
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "frames.txt"),
    "-vf",
    `fps=${gif.fps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    "-loop",
    "0",
    `${out}/${name}.gif`,
  ]);

  await rm(dir, { recursive: true });

  await page.setViewportSize(roomy);

  console.log(`${out}/${name}.gif (${shots.length} frames)`);
}

// LIVE while recording, annotated: two spikes and two events, so the graph shows what it marks.
await open("?mode=full");

await page.getByRole("button", { name: "REC", exact: true }).click();

await settle();

await page.evaluate((ms) => window.fixture.spike(ms), spikeMs);

await settle();

await settle();

await page.evaluate(() => window.fixture.event("load chunk 14"));

await settle();

await page.evaluate((ms) => window.fixture.spike(ms), spikeMs);

await annotate("panel-annotated");

// One line, then the mini view, over the same spike.
await open();

await page.evaluate(() => window.fixture.monitor.startRecording());

await page.evaluate((ms) => window.fixture.spike(ms), spikeMs);

await page.locator('[data-k="line-worst"][data-tone="miss"]').waitFor();

await capture("panel-line");

await page.getByRole("button", { name: "Open full panel" }).click();

await page.getByRole("button", { name: "Shrink to mini view" }).click();

// A fresh spike: the first has scrolled out of the mini graph by now.
await page.evaluate((ms) => window.fixture.spike(ms), spikeMs);

await settle();

await capture("panel-mini");

// LOADING: the stages, the cold run and every session.
await open("?mode=full");

await page.getByRole("tab", { name: "LOADING" }).click();

await settle();

await capture("panel-loading");

// CAPTURE: automatic capture armed, then one spike kept with the frames around it.
await open("?mode=full");

await page.getByRole("tab", { name: "CAPTURE" }).click();

// The panel's own toggle: it keeps only captures it asked for. Armed before the spike.
await page.getByRole("button", { name: "Automatic spike capture" }).click();

await page
  .locator('[aria-label="Automatic spike capture"][aria-pressed="true"]')
  .waitFor();

await page.locator('[data-k="state"]', { hasText: "armed" }).waitFor();

await page.evaluate((ms) => window.fixture.spike(ms), captureSpikeMs);

// The kept capture's row, once the frames after the spike are in.
await page.locator('[data-k="captures"] .jank-ms').waitFor();

await capture("panel-capture");

// Running: the graph glides as it does live, a spike passes and an event is marked.
await page.emulateMedia({ reducedMotion: "no-preference" });

await open("?mode=full");

await page.getByRole("button", { name: "REC", exact: true }).click();

await settle();

await settle();

await film("panel-running", async () => {
  await page.waitForTimeout(gif.leadMs);

  await page.evaluate((ms) => window.fixture.spike(ms), spikeMs);

  await settle();

  await settle();

  await page.evaluate(() => window.fixture.event("load chunk 14"));

  await page.waitForTimeout(gif.tailMs);
});

await browser.close();
