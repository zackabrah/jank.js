import { expect, test } from "@playwright/test";

test("@visual panel retains LINE, MINI, FULL and capture layouts", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.advance(70);
    window.panelFixture.profiler.capture.start();
    window.panelFixture.advance(1, 40);
    window.panelFixture.advance(8);
    window.panelFixture.profiler.capture.stop();
    window.panelFixture.refresh();
  });
  const panel = page.locator(".jank");
  const costs = {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  };
  await expect(panel).toHaveScreenshot("panel-full.png", costs);
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(panel).toHaveScreenshot("panel-capture.png", costs);
  await page.getByRole("button", { name: "Shrink to mini view" }).click();
  await expect(panel).toHaveScreenshot("panel-mini.png");
  await page.getByRole("button", { name: "Collapse to one line" }).click();
  await expect(panel).toHaveScreenshot("panel-line.png");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(panel).toHaveScreenshot("panel-line-narrow.png");
  await page.getByRole("button", { name: "Open full panel" }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(panel).toHaveScreenshot("panel-full-narrow.png", costs);
});
