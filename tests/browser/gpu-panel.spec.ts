import { expect, test } from "@playwright/test";
import { gpuIntervalFixture } from "../fixtures/gpu-sample.ts";

test("GPU intervals show distinct sums, busy union, span, repeated passes and completeness", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate((sample) => {
    window.panelFixture.advance(3);
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      currentFrameSequence: 5,
      pendingFrames: 2,
      droppedSamples: 1,
      sample,
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  const gpu = page.locator('[data-list="gpu"]');
  for (const label of [
    "Render pass sum",
    "Compute pass sum",
    "Combined pass sum",
    "GPU busy (union)",
    "GPU elapsed span",
  ]) {
    await expect(gpu).toContainText(label);
  }
  await expect(gpu).toContainText("4.00");
  await expect(gpu).toContainText("6.00");
  await expect(gpu).toContainText("10.00");
  await expect(gpu).toContainText("8.00");
  await expect(gpu).toContainText("9.00");
  await expect(gpu).toContainText("Ocean FFT · compute · water · #1");
  await expect(gpu).toContainText("Ocean FFT · compute · water · #3");
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("stale");
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("age 4 application frames");
  await page.evaluate((sample) => {
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      currentFrameSequence: 2,
      droppedSamples: 0,
      sample: {
        ...sample,
        sequence: 2,
        completeness: "incomplete",
        expectedPasses: 4,
        omittedPasses: 1,
        issues: ["query-capacity"],
        metrics: null,
      },
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("incomplete");
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("query-capacity");
  await expect(gpu).not.toContainText("10.00");
  await expect(gpu).toContainText("Ocean FFT");
});
