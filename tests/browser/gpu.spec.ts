import { expect, test } from "@playwright/test";

for (const backend of ["webgl2", "webgpu"]) {
  test(`real ${backend} timing records correlated GPU samples or reports unsupported hardware`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/fixtures/gpu/?backend=${backend}`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const initial = await page.evaluate(() => window.gpuFixture.source.read());
    if (initial.status === "unsupported") {
      testInfo.annotations.push({ type: "GPU unavailable", description: initial.reason });
      await expect(page.locator('[data-value="gpu-note"]')).toContainText(initial.reason);
    } else {
      await expect
        .poll(() => page.evaluate(() => window.gpuFixture.source.read().status), {
          timeout: 15_000,
        })
        .toBe("ready");
      const sample = await page.evaluate(() => window.gpuFixture.source.read());
      expect(sample.status).toBe("ready");
      if (sample.status === "ready") {
        expect(sample.sample.frameId).not.toBeNull();
        if (backend === "webgpu") {
          expect(sample.sample.measurement).toBe("intervals");
          if (sample.sample.measurement === "intervals") {
            expect(sample.sample.completeness).toBe("complete");
            expect(
              sample.sample.passes.filter((pass) => pass.type === "compute").length,
            ).toBeGreaterThanOrEqual(2);
            expect(
              sample.sample.passes.filter((pass) => pass.type === "render").length,
            ).toBeGreaterThanOrEqual(2);
            expect(sample.sample.metrics?.combinedSumMs).toBeGreaterThanOrEqual(
              sample.sample.metrics?.busyMs ?? Infinity,
            );
          }
        } else {
          expect(sample.sample.measurement).toBe("pass-sum");
        }
        expect(sample.currentRendererFrameId).toBeGreaterThanOrEqual(sample.sample.rendererFrameId);
        // Readback can finish before the next host boundary seals the measured frame.
        await expect
          .poll(() =>
            page.evaluate(
              (frameId) =>
                window.gpuFixture.profiler.snapshot().frames.some((frame) => frame.id === frameId),
              sample.sample.frameId,
            ),
          )
          .toBe(true);
      }
      const recording = await page.evaluate(() => window.gpuFixture.profiler.capture.stop());
      expect(recording?.gpu.length).toBeGreaterThan(0);
      expect(
        recording?.gpu.every(
          (sample) =>
            sample.frameId !== null &&
            recording.frames.some((frame) => frame.id === sample.frameId),
        ),
      ).toBe(true);
    }
    const before = await page.evaluate(() => window.gpuFixture.frames());
    await page.evaluate(() => {
      window.gpuFixture.source.dispose();
      window.gpuFixture.source.dispose();
    });
    await expect
      .poll(() => page.evaluate(() => window.gpuFixture.frames()))
      .toBeGreaterThan(before + 3);
    expect(errors).toEqual([]);
  });
}

test("WebGPU intervals agree with a separate raw readback", async ({ page }, testInfo) => {
  await page.goto("/tests/fixtures/gpu/?backend=webgpu");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const state = await page.evaluate(() => window.gpuFixture.source.read());
  test.skip(state.status === "unsupported", "Native WebGPU timestamp queries unavailable");
  const evidence = await page.evaluate(() => window.gpuFixture.reference());
  const sample = evidence.result.samples.find((sample) => sample.frameId === evidence.frameId);
  expect(evidence.result.status).toBe("settled");
  expect(sample?.completeness).toBe("complete");
  if (!sample) {
    throw new Error("Missing associated GPU frame");
  }
  expect(sample.passes).toHaveLength(evidence.raw.length);
  for (const [index, raw] of evidence.raw.entries()) {
    const pass = sample.passes[index];
    expect(pass?.type).toBe(raw.type);
    expect(BigInt(sample.clock.originNs) + BigInt(pass?.startNs ?? -1)).toBe(BigInt(raw.startNs));
    expect(BigInt(sample.clock.originNs) + BigInt(pass?.endNs ?? -1)).toBe(BigInt(raw.endNs));
  }
  const reference = independentMetrics(evidence.raw);
  expect(sample.metrics).toEqual(reference);
  expect(sample.passes.filter((pass) => pass.id === "fill")).toHaveLength(2);
  expect(sample.passes.filter((pass) => pass.id === "scene").length).toBeGreaterThanOrEqual(2);
  await testInfo.attach("independent-gpu-readback.json", {
    body: JSON.stringify({ evidence, reference }, null, 2),
    contentType: "application/json",
  });
});

function independentMetrics(raw: readonly { type: string; startNs: string; endNs: string }[]) {
  const intervals = raw.map((pass) => ({
    type: pass.type,
    start: BigInt(pass.startNs),
    end: BigInt(pass.endNs),
  }));
  const sum = (type: string) =>
    intervals
      .filter((pass) => pass.type === type)
      .reduce((total, pass) => total + pass.end - pass.start, 0n);
  const render = sum("render");
  const compute = sum("compute");
  // Independent endpoint sweep: simultaneous boundaries are grouped before accumulating busy time.
  const changes = new Map<bigint, number>();
  for (const pass of intervals) {
    changes.set(pass.start, (changes.get(pass.start) ?? 0) + 1);
    changes.set(pass.end, (changes.get(pass.end) ?? 0) - 1);
  }
  const boundaries = [...changes.keys()].sort((a, b) => Number(a - b));
  let active = 0;
  let previous = boundaries[0] ?? 0n;
  let busy = 0n;
  for (const boundary of boundaries) {
    if (active > 0) {
      busy += boundary - previous;
    }
    active += changes.get(boundary) ?? 0;
    previous = boundary;
  }
  return {
    renderSumMs: Number(render) / 1e6,
    computeSumMs: Number(compute) / 1e6,
    combinedSumMs: Number(render + compute) / 1e6,
    busyMs: Number(busy) / 1e6,
    elapsedSpanMs: Number((boundaries.at(-1) ?? 0n) - (boundaries[0] ?? 0n)) / 1e6,
  };
}

test("WebGPU instrumentation overhead and resource stability", async ({ page }, testInfo) => {
  test.skip(!process.env.JANK_GPU_BENCHMARK, "Opt-in hardware measurement");
  test.setTimeout(60_000);
  await page.goto("/tests/fixtures/gpu/?backend=webgpu");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const state = await page.evaluate(() => window.gpuFixture.source.read());
  test.skip(state.status === "unsupported", "Native WebGPU timestamp queries unavailable");
  const report = await page.evaluate(() => window.gpuFixture.benchmark());
  expect(report.afterDispose?.liveBuffers).toBe(0);
  expect(report.afterDispose?.liveQueries).toBe(0);
  for (const batch of report.batches) {
    expect(batch.after?.liveBuffers).toBeLessThanOrEqual(8);
    expect(batch.after?.liveQueries).toBeLessThanOrEqual(4);
    expect(batch.diagnostics?.retainedFrames ?? 0).toBeLessThanOrEqual(128);
  }
  await testInfo.attach("gpu-overhead.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});

test("a stopped capture includes its pending WebGPU frame after bounded finalization", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/gpu/?backend=webgpu");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const state = await page.evaluate(() => window.gpuFixture.source.read());
  test.skip(state.status === "unsupported", "Native WebGPU timestamp queries unavailable");
  const finished = await page.evaluate(() => window.gpuFixture.finalize());
  expect(finished.pendingFrames).toBeGreaterThan(0);
  expect(finished.result.status).toBe("settled");
  expect(finished.result.complete).toBe(true);
  expect(finished.result.recording.gpu.some((sample) => sample.frameId === finished.frameId)).toBe(
    true,
  );
});
