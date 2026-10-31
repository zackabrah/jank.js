import { expect, test } from "@playwright/test";

test("mock preview advances on request and exposes loading states without a live stream", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/examples/ui-library/");
  const panel = page.locator("#full-preview");
  await expect(page.getByRole("button", { name: "Resume sample stream" })).toBeVisible();
  await page.getByRole("button", { name: "Advance 60 sample frames" }).click();
  await expect(panel.locator('[data-value="gpu-note"]')).toContainText("210");
  await panel.getByRole("tab", { name: "LOADING", exact: true }).click();
  const loading = page.getByRole("combobox", { name: "Loading example", exact: true });
  for (const state of ["loading", "failed", "cancelled", "ready"]) {
    await loading.selectOption(state);
    await expect(panel.locator('[data-value="loading-state"]')).toContainText(
      new RegExp(state, "i"),
    );
  }
  await loading.selectOption("empty");
  await expect(panel.locator('[data-value="loading-state"]')).toContainText(/no loading/i);
});
