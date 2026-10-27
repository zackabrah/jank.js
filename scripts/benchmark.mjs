import { chromium } from "@playwright/test";

import { createServer } from "node:http";

import { readFile, mkdir, writeFile } from "node:fs/promises";

import { dirname, resolve } from "node:path";

import { cpus, platform, arch } from "node:os";

// Serve only the built library and this small fixture, on a loopback ephemeral port.
const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  const files = {
    "/index.js": ["dist-package/index.js", "text/javascript"],
    "/style.css": ["dist-package/style.css", "text/css"],
  };

  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");

      response.end(
        '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><main id="app" style="position:relative;width:1200px;height:800px"><canvas width="1200" height="800"></canvas></main></body></html>',
      );
    } else if (Object.hasOwn(files, request.url ?? "")) {
      const [file, type] = files[request.url];

      response.setHeader("Content-Type", type);

      response.end(await readFile(file));
    } else {
      response.statusCode = 404;

      response.end();
    }
  } catch {
    response.statusCode = 500;

    response.end();
  }
});

await new Promise((resolveReady) =>
  server.listen(0, "127.0.0.1", resolveReady),
);

let browser;

try {
  browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  });

  const address = server.address();

  const url = `http://127.0.0.1:${address.port}`;

  const runs = [];

  // Sequential runs prevent the benchmark competing with itself for CPU time.
  /* oxlint-disable no-await-in-loop */
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const state of [
      "baseline",
      "collapsed",
      "expanded",
      "recording",
      "armed",
    ]) {
      await page.goto(url);

      const result = await page.evaluate(async (mode) => {
        const { createDiagnostics, createPerformanceTray } =
          await import("/index.js");

        // The panel remembers its size per origin; every state starts from the default.
        localStorage.clear();

        const shell = document.querySelector("#app");

        const canvas = shell.querySelector("canvas");

        const ctx = canvas.getContext("2d");

        const monitor = mode === "baseline" ? undefined : createDiagnostics();

        const tray = monitor
          ? createPerformanceTray({ shell, monitor })
          : undefined;

        const channel = monitor?.register("scene", "Canvas drawing", () => ({
          strokes: 24,
        }));

        // Expanded is the full panel with the LIVE tab, its most expensive view.
        if (mode === "expanded" || mode === "recording")
          shell.querySelector('[data-action="line-grow"]').click();

        const seed = performance.now();

        for (let i = 0; i < 600; i++)
          monitor?.frame(seed - (600 - i) * 16.67, 16.67, 0, 0.1);

        if (mode === "recording") monitor.startRecording();

        if (mode === "armed") monitor.armCapture();

        const costs = [],
          intervals = [],
          sceneCosts = [];

        let previous = 0,
          count = 0;

        await new Promise((done) => {
          function frame(at) {
            const before = performance.now();

            monitor?.beginFrame(at);

            const token = channel?.begin();

            const drawStart = performance.now();

            ctx.clearRect(0, 0, 1200, 800);

            ctx.strokeStyle = "#a3e635";

            for (let line = 0; line < 24; line++) {
              ctx.beginPath();

              for (let x = 0; x < 1200; x += 8) {
                const y = 350 + line * 5 + Math.sin(x * 0.01 + at * 0.001) * 50;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }

              ctx.stroke();
            }

            const drawEnd = performance.now();

            if (channel) channel.end(token);

            monitor?.endFrame(0, drawEnd - drawStart);

            tray?.refresh(at);

            const after = performance.now();

            if (count >= 30) {
              costs.push(after - before - (drawEnd - drawStart));

              sceneCosts.push(drawEnd - drawStart);

              intervals.push(at - previous);
            }

            previous = at;

            if (++count < 150) requestAnimationFrame(frame);
            else done();
          }

          requestAnimationFrame(frame);
        });

        // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this callback into the browser; helpers must live inside it.
        const summarize = (values) => {
          const sorted = values.toSorted((a, b) => a - b);

          return {
            mean: values.reduce((sum, value) => sum + value, 0) / values.length,
            p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
            max: sorted.at(-1),
          };
        };

        tray?.dispose();

        channel?.dispose();

        monitor?.dispose();

        return {
          state: mode,
          samples: costs.length,
          monitorAndTimerMs: summarize(costs),
          sceneCpuMs: summarize(sceneCosts),
          frameIntervalMs: summarize(intervals),
          isolatedClock: crossOriginIsolated,
        };
      }, state);

      runs.push({ repetition: repetition + 1, ...result });
    }
  }

  /* oxlint-enable no-await-in-loop */
  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model,
    units: "milliseconds",
    methodology:
      "Three sequential repetitions per state. Each run seeds 600 history entries, warms up 30 real animation frames, then measures 120. Explicit beginFrame/endFrame capture. One Canvas 2D system, 1200x800 viewport, system font, no GPU provider. Monitor timing includes collection and synchronous UI refresh plus timer overhead, excludes scene drawing, browser paint and GPU execution. Baseline measures timer/loop overhead. Headless results are illustrative, not a universal performance guarantee.",
    runs,
  };

  const destination = resolve(process.argv[2] ?? "artifacts/overhead.json");

  await mkdir(dirname(destination), { recursive: true });

  await writeFile(destination, JSON.stringify(report, null, 2) + "\n");

  for (const state of [
    "baseline",
    "collapsed",
    "expanded",
    "recording",
    "armed",
  ]) {
    const selected = runs.filter((run) => run.state === state);

    const mean =
      selected.reduce((sum, run) => sum + run.monitorAndTimerMs.mean, 0) /
      selected.length;

    console.log(
      `${state}: ${mean.toFixed(4)} ms/frame mean across ${selected.length} runs`,
    );
  }

  console.log(`Report: ${destination}`);
} finally {
  await browser?.close();

  await new Promise((done) => server.close(done));
}
