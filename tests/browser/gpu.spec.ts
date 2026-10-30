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
        expect(sample.sample.measurement).toBe("pass-sum");
        expect(
          sample.sample.measurement !== "intervals" && sample.sample.durationMs,
        ).toBeGreaterThanOrEqual(0);
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
