import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures/visual-test.ts";

test("optional diagnostics route controls, retain view order and freeze without mutating host state", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/integrations/");
  const culling = page.getByRole("button", { name: "Visibility culling", exact: true });
  await expect(culling).toHaveAttribute("aria-pressed", "true");
  await culling.click();
  await page.getByRole("button", { name: "Debug bounds", exact: true }).click();
  await page.getByRole("button", { name: "Instance culling", exact: true }).click();
  await page.getByLabel("Temporal debug view").selectOption("motion");
  await page.getByRole("button", { name: "Rigid object history", exact: true }).click();
  expect(await page.evaluate(() => window.integrationsFixture.state())).toMatchObject({
    visibility: { enabled: false, debugBounds: true, instances: { enabled: false } },
    temporal: { debugView: "motion", objectMotion: false },
  });
  await expect(page.locator('[data-list="instances"]')).toContainText("2 frames old");
  const order = await page
    .locator('[data-list="visibility"] .jank-row > :first-child')
    .allTextContents();
  await page.evaluate(() => {
    window.integrationsFixture.reverse();
    window.integrationsFixture.refresh();
  });
  expect(
    await page.locator('[data-list="visibility"] .jank-row > :first-child').allTextContents(),
  ).toEqual(order);
  await page.getByRole("button", { name: "Freeze display", exact: true }).click();
  await expect(culling).toBeDisabled();
  await page.evaluate(() => {
    window.integrationsFixture.clear();
    window.integrationsFixture.refresh();
  });
  await expect(page.locator('[data-list="instances"]')).toContainText("2 frames old");
  await page.getByRole("button", { name: "Resume display", exact: true }).click();
  await expect(page.locator('[data-value="visibility-status"]')).toContainText("unavailable");
  await expect(page.getByLabel("Temporal debug view")).toBeDisabled();
  await page.evaluate(() => {
    window.integrationsFixture.fail();
    window.integrationsFixture.refresh();
  });
  await expect(page.locator('[data-value="visibility-status"]')).toContainText(
    "Host visibility unavailable",
  );
});
for (const width of [390, 1280]) {
  test(`@visual optional diagnostics at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/tests/fixtures/integrations/");
    for (const name of ["scopes", "gpu", "counters", "events"]) {
      await page.locator(`[data-section="${name}"] > summary`).click();
    }
    expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
    await expect(page.locator(".jank")).toHaveScreenshot(`integrations-${width}.png`, {
      mask: [
        page.locator('[data-value="refresh-cost"]'),
        page.locator('[data-value="collection-cost"]'),
      ],
    });
  });
}
