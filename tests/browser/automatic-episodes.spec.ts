import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("episode controls merge slow frames, inspect trigger history and export one complete episode", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page
    .getByLabel("Capture window", { exact: true })
    .selectOption("episode", { timeout: 2000 });
  await page.getByLabel("Threshold ms", { exact: true }).fill("25");
  await page.getByLabel("Before seconds", { exact: true }).fill("0.03");
  await page.getByLabel("Minimum after seconds", { exact: true }).fill("0.03");
  await page.getByLabel("Quiet recovery seconds", { exact: true }).fill("0.04");
  await page.getByLabel("Episode limit seconds", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Arm automatic capture", exact: true }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.evaluate(() => {
    const f = window.panelFixture;
    f.advance(4, 16);
    f.advance(1, 35);
    f.advance(1, 16);
    f.advance(1, 35);
    f.panel.refresh(1000);
  });
  await expect(page.locator("[data-automatic-status]")).toContainText("2 triggers");
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.list().length)).toBe(0);
  await page.evaluate(() => {
    window.panelFixture.advance(3, 16);
    window.panelFixture.panel.refresh(2000);
  });
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.list().length)).toBe(1);
  await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-episode-summary]")).toContainText("2 triggers · recovered");
  const select = dialog.getByLabel("Episode trigger", { exact: true });
  const ids = await select
    .locator('option:not([value=""])')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value")));
  await select.selectOption(ids[1] ?? "");
  await expect(dialog.locator("[data-viewer-frame]")).toContainText(`Frame #${ids[1]}`);
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export selected episode", exact: true }).click();
  const path = await (await downloading).path();
  if (!path) {
    throw new Error("No episode download");
  }
  const recording = JSON.parse(await readFile(path, "utf8"));
  expect(recording.schemaVersion).toBe(6);
  expect(recording.capture.episode.triggerFrameIds).toEqual(ids.map(Number));
  expect(recording.capture.episode.timeWindow.recoveryMs).toBe(40);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [390, 1280]) {
  test(`@visual episode settings and inspection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tests/fixtures/panel/?mode=full");
    await page.evaluate(() => {
      const f = window.panelFixture;
      f.profiler.capture.arm({
        thresholdMs: 25,
        beforeFrames: 0,
        afterFrames: 0,
        cooldownMs: 1000,
        timeWindow: { beforeMs: 30, afterMs: 30, recoveryMs: 40, maxDurationMs: 1000 },
      });
      f.mount("full");
    });
    await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
    await expect(page.getByLabel("Capture window", { exact: true })).toHaveValue("episode");
    await expect(page.getByLabel("Quiet recovery seconds", { exact: true })).toHaveValue("0.04");
    await expect(page.getByLabel("Before frames", { exact: true })).toBeHidden();
    await expect(page.locator(".jank")).toHaveScreenshot(`episode-settings-${width}.png`);
    await page.getByRole("tab", { name: "LIVE", exact: true }).click();
    await page.evaluate(() => {
      const f = window.panelFixture;
      f.advance(4, 16);
      f.advance(2, 35);
      f.advance(3, 16);
      f.panel.refresh(2000);
    });
    await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-episode-summary]")).toContainText("2 triggers · recovered");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(dialog).toHaveScreenshot(`episode-inspector-${width}.png`, {
      mask: [
        dialog.locator('[data-work-key="overhead"]'),
        dialog.locator('[data-lane-kind="frame"]').filter({ hasText: "profiler" }),
      ],
    });
  });
}
