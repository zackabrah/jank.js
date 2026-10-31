import { expect, test } from "@playwright/test";

test("demo visibility controls affect real submission and temporal previews own their canvases", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  await page.getByRole("button", { name: "Inspect culling" }).click();
  const view = page.locator('[data-list="visibility"]');
  await expect(view).toContainText("Main");
  await expect
    .poll(async () => {
      const text = (await view.textContent()) ?? "";
      return Number(text.split("/").at(-1)?.trim());
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Debug bounds", exact: true }).click();
  await expect(page.locator("[data-jank-bounds]")).toBeVisible();
  await expect(page.locator("[data-jank-bounds]")).toHaveAttribute("data-drawn", "36");
  await page.getByRole("button", { name: "Visibility culling", exact: true }).click();
  await expect(view).toContainText("36 / 36 / 0");
  await page.getByRole("button", { name: "Rigid object history", exact: true }).click();
  await page.getByLabel("Temporal debug view").selectOption("history");
  await expect(page.locator("[data-demo-temporal]")).toBeVisible();
  await expect(page.locator("[data-demo-temporal]")).toHaveAttribute("data-valid", "36");
  await page.getByLabel("Temporal debug view").selectOption("motion");
  await expect(page.locator('[data-value="temporal-status"]')).toContainText("CPU-projected");
  await page.getByLabel("Temporal debug view").selectOption("none");
  await expect(page.locator("[data-demo-temporal]")).toBeHidden();
  await expect(page.getByRole("button", { name: "Instance culling", exact: true })).toBeDisabled();
  await expect(page.locator("#demo-error")).toBeHidden();
});
