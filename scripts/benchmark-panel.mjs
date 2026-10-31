import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
  const address = server.resolvedUrls?.local[0];
  if (!address) {
    throw new Error("Benchmark fixture server has no address");
  }
  await page.goto(`${address}tests/fixtures/panel/`);
  await page.waitForFunction(() => document.body.dataset.ready === "true");
  const results = await page.evaluate(async () => {
    const { createPanel, createProfiler } = await import("/packages/jank/src/index.ts");
    const { createDiagnosticPreview } = await import("/examples/ui-library/diagnostic-preview.ts");
    window.panelFixture.panel.dispose();
    window.panelFixture.profiler.dispose();
    const results = [];
    const framesPerSample = 5000;
    function sample(mode, visible) {
      localStorage.clear();
      let timeMs = 0;
      const profiler = createProfiler({ now: () => timeMs });
      const channel = profiler.createChannel({
        id: "work",
        label: "Work",
        readCounters: () => ({ objects: 100, calls: 20 }),
      });
      // Equal scope collection in the baseline isolates the incremental presentation work.
      profiler.requestScopes();
      const panel = visible
        ? createPanel({
            container: document.body,
            profiler,
            mode: mode === "full-diagnostics" ? "full" : mode,
            ...(mode === "full-diagnostics" ? createDiagnosticPreview() : {}),
          })
        : null;
      function frame(index) {
        timeMs = index * 16.7;
        profiler.beginFrame(timeMs);
        for (let scope = 0; scope < 8; scope += 1) {
          const token = channel.begin();
          timeMs += 0.01;
          channel.end(token);
        }
        profiler.endFrame({ updateMs: 1, renderMs: 2 });
        panel?.refresh(timeMs);
      }
      for (let index = 0; index < 600; index += 1) {
        frame(index);
      }
      const startedAtMs = performance.now();
      for (let index = 600; index < 600 + framesPerSample; index += 1) {
        frame(index);
      }
      const millisecondsPerHostFrame = (performance.now() - startedAtMs) / framesPerSample;
      panel?.dispose();
      profiler.dispose();
      return millisecondsPerHostFrame;
    }
    for (const mode of ["line", "mini", "full", "full-diagnostics"]) {
      sample(mode, false);
      sample(mode, true);
      const samples = [];
      for (let index = 0; index < 15; index += 1) {
        const baselineFirst = index % 2 === 0;
        const first = sample(mode, !baselineFirst);
        const second = sample(mode, baselineFirst);
        const baseline = baselineFirst ? first : second;
        const instrumented = baselineFirst ? second : first;
        samples.push({ baseline, instrumented, incremental: instrumented - baseline });
      }
      const incremental = samples.map((sample) => sample.incremental).sort((a, b) => a - b);
      results.push({
        mode,
        framesPerSample,
        samples,
        medianIncrementalMsPerHostFrame: incremental[7],
        minimum: incremental[0],
        maximum: incremental.at(-1),
      });
    }
    return results;
  });
  const report = {
    collectedAt: new Date().toISOString(),
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    browser: `headless Chromium ${browser.version()}`,
    method:
      "15 paired batches per mode, alternating order, 5000 synthetic host frames after 600 warmup frames; both paths collect eight scopes and counters. One discarded warmup pair per mode.",
    limits:
      "Incremental synchronous milliseconds per HOST FRAME, including normal refresh throttling, copying, DOM/canvas commands and any forced layout. Not cost per redraw. Headless tight loops exclude deferred paint/GPU and real frame scheduling. The full-diagnostics case includes static visibility/instance/temporal source reads and controls. No renderer, bounds drawing, archive, loading or old-panel comparison; batch ranges are not individual-frame tail latency.",
    results,
  };
  mkdirSync("artifacts", { recursive: true });
  writeFileSync("artifacts/panel-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
