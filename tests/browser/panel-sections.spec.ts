import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("main sections collapse independently with pointer and keyboard while collection continues", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  const tabs = [
    { name: "LIVE", sections: ["scopes", "gpu", "counters", "events"] },
    { name: "LOADING", sections: ["loading", "loading-cache", "loading-sessions"] },
    {
      name: "CAPTURE",
      sections: ["completeness", "budget", "automatic", "instrumentation", "captures"],
    },
  ];
  for (const tab of tabs) {
    await page.getByRole("tab", { name: tab.name, exact: true }).click();
    for (const id of tab.sections) {
      const section = page.locator(`[data-section="${id}"]`);
      const header = section.locator(":scope > summary");
      const content = section.locator(":scope > div");
      await expect(section).toHaveAttribute("open", "");
      await header.click();
      await expect(content).toBeHidden();
      await header.focus();
      await page.keyboard.press("Enter");
      await expect(content).toBeVisible();
      await page.keyboard.press("Space");
      await expect(content).toBeHidden();
      await expect(header).toBeFocused();
    }
    expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
  }
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => window.panelFixture.advance(12));
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState())).toMatchObject({
    recordedFrames: 12,
  });
  await page.getByRole("button", { name: "Shrink to mini view" }).click();
  await page.getByRole("button", { name: "Expand to full panel" }).click();
  await expect(page.locator(".jank-section[open]")).toHaveCount(0);
  await page.locator('[data-section="scopes"] > summary').click();
  await expect(page.locator('[data-list="scopes"]')).toContainText("physics");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("collapsing capture settings preserves edits across refresh and tab changes", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Threshold ms", { exact: true }).fill("37");
  const header = page.locator('[data-section="automatic"] > summary');
  await header.click();
  await page.evaluate(() => window.panelFixture.advance(12));
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.getByLabel("Threshold ms", { exact: true })).toBeHidden();
  await header.click();
  await expect(page.getByLabel("Threshold ms", { exact: true })).toHaveValue("37");
});
