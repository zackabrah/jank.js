import { gpuIntervalFixture } from "../fixtures/gpu-sample.ts";
import { expect, test } from "../fixtures/visual-test.ts";

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
  await expect(gpu).toContainText("Ocean FFT · compute · water · #2");
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

test("custom interval sources report unknown age and pending count explicitly", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate((sample) => {
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      droppedSamples: 0,
      sample,
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("age unavailable");
  await expect(page.locator('[data-value="gpu-note"]')).toContainText("pending count unavailable");
});

test("@visual compute and render GPU measurements remain readable at narrow width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 1100 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate((sample) => {
    window.panelFixture.advance(3);
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      currentFrameSequence: 2,
      pendingFrames: 1,
      droppedSamples: 0,
      sample,
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  const explanation = page.locator("[data-gpu-explanation]");
  await explanation.locator("summary").click();
  await page.getByRole("region", { name: "Performance details" }).evaluate((region) => {
    region.scrollTop = region.scrollHeight;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.locator(".jank")).toHaveScreenshot("gpu-intervals-narrow.png", {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  });
});
