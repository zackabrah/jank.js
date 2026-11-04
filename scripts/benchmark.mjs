// Per-frame cost of the built panel in headless Chromium: collection, refresh and timer overhead.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { arch, cpus, platform } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const viewport = { width: 1200, height: 800 };
const states = ["baseline", "line", "mini", "full", "recording", "armed"];
const repetitions = 3;
const packageRoot = resolve("dist-package");
const page = `<!doctype html><html lang="en"><body style="margin:0"><main id="app" style="position:relative;width:1200px;height:800px"><canvas width="1200" height="800"></canvas></main></body></html>`;

// Serves only the built package and this fixture, on a loopback ephemeral port.
const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(page);
    return;
  }
  const file = resolve(packageRoot, `.${pathname}`);
  try {
    if (!file.startsWith(packageRoot + sep) || extname(file) !== ".js") throw new Error("Not served");
    const body = await readFile(file);
    response.setHeader("Content-Type", "text/javascript");
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const tab = await browser.newPage({ viewport });
  const url = `http://127.0.0.1:${server.address().port}`;
  const runs = [];
  // Sequential runs keep the benchmark from competing with itself for CPU time.
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const state of states) {
      await tab.goto(url);
      const result = await tab.evaluate(async (mode) => {
        // Playwright serializes this callback into the browser, so its constants live inside it.
        const seededFrames = 600;
        const seededIntervalMs = 16.67;
        const seededRenderMs = 0.1;
        const sceneLines = 24;
        const warmupFrames = 30;
        const totalFrames = 150;

        // These paths exist only on this script's server, in the browser.
        const [{ createDiagnostics }, { createPerformancePanel }] = await Promise.all(
          ["/index.js", "/panel.js"].map((entry) => import(entry)),
        );
        const shell = document.querySelector("#app");
        const canvas = shell.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        // Seeded history must follow the collector's origin, so the clock jumps past it after creation.
        let skew = 0;
        const monitor =
          mode === "baseline" ? undefined : createDiagnostics(() => performance.now() + skew);
        const panel = monitor && createPerformancePanel({ shell, monitor });
        const channel = monitor?.register("scene", "Canvas drawing", () => ({
          strokes: sceneLines,
        }));

        if (panel) {
          panel.refresh(performance.now(), true);
          await new Promise(requestAnimationFrame);
          const root = shell.lastElementChild.firstElementChild.shadowRoot;
          const view = { line: "Line view", mini: "Mini view", armed: "Line view" }[mode];
          if (view) {
            const button = [...root.querySelectorAll("button")].find(
              (item) => item.getAttribute("aria-label") === view && !item.closest("[hidden]"),
            );
            if (!button) throw new Error(`Missing ${view}`);
            button.click();
            await new Promise(requestAnimationFrame);
          }
          // A wrong state would silently measure the wrong thing.
          const shown = root.querySelector("[data-mode]")?.getAttribute("data-mode");
          const expected = mode === "mini" || mode === "line" ? mode : mode === "armed" ? "line" : "full";
          if (shown !== expected) throw new Error(`${mode} rendered as ${shown}`);
        }

        skew = seededFrames * seededIntervalMs + 100;
        const seed = performance.now() + skew;
        for (let i = 0; i < seededFrames; i++)
          monitor?.frame(
            seed - (seededFrames - i) * seededIntervalMs,
            seededIntervalMs,
            0,
            seededRenderMs,
          );

        if (mode === "recording") {
          panel.capture.start();
          if (panel.capture.getSnapshot().phase !== "recording") throw new Error("Not recording");
        }
        if (mode === "armed") {
          panel.capture.toggleAuto();
          if (panel.capture.getSnapshot().automatic?.state !== "armed") throw new Error("Not armed");
        }

        const costs = [];
        const intervals = [];
        const sceneCosts = [];
        let previous = 0;
        let count = 0;
        await new Promise((done, fail) => {
          function measured(at) {
            const before = performance.now();
            monitor?.beginFrame(at + skew);
            panel?.refresh(at + skew);
            const token = channel?.begin();
            const drawStart = performance.now();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "#a3e635";
            for (let line = 0; line < sceneLines; line++) {
              ctx.beginPath();
              for (let x = 0; x < canvas.width; x += 8) {
                const y = 350 + line * 5 + Math.sin(x * 0.01 + at * 0.001) * 50;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.stroke();
            }
            const drawEnd = performance.now();
            if (channel) channel.end(token);
            monitor?.endFrame(0, drawEnd - drawStart);
            const after = performance.now();
            if (count >= warmupFrames) {
              costs.push(after - before - (drawEnd - drawStart));
              sceneCosts.push(drawEnd - drawStart);
              intervals.push(at - previous);
            }
            previous = at;
            if (++count < totalFrames) requestAnimationFrame(frame);
            else done();
          }
          // A throw would otherwise end the loop and leave this promise pending forever.
          function frame(at) {
            try {
              measured(at);
            } catch (error) {
              fail(error);
            }
          }
          requestAnimationFrame(frame);
        });

        const summarize = (values) => {
          const sorted = values.toSorted((a, b) => a - b);
          return {
            mean: values.reduce((sum, value) => sum + value, 0) / values.length,
            p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
            max: sorted.at(-1),
          };
        };
        panel?.destroy();
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
      runs.push({ repetition, ...result });
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    browser: browser.version(),
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model,
    units: "milliseconds",
    methodology:
      "Three sequential repetitions per state. Each run seeds 600 history entries, warms up 30 real animation frames, then measures 120. Explicit beginFrame/endFrame capture with panel.refresh straight after beginFrame. One Canvas 2D system, 1200x800 viewport, system font, no GPU provider. Monitor timing includes collection and synchronous panel refresh plus timer overhead, excludes scene drawing, browser paint and GPU execution. Baseline measures timer/loop overhead. Recording uses the full panel on its Live tab; armed uses the line view. Headless results are illustrative, not a universal performance guarantee.",
    runs,
  };
  const destination = resolve(process.argv[2] ?? "artifacts/overhead.json");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  for (const state of states) {
    const selected = runs.filter((run) => run.state === state);
    const mean = selected.reduce((sum, run) => sum + run.monitorAndTimerMs.mean, 0) / selected.length;
    const max = Math.max(...selected.map((run) => run.monitorAndTimerMs.max));
    console.log(`${state}: ${mean.toFixed(4)} ms/frame mean, ${max.toFixed(3)} ms largest, ${selected.length} runs`);
  }
  console.log(`Report: ${destination}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
