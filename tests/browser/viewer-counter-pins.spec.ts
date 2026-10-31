import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { counterComparisonFixture } from "../fixtures/counter-comparison.ts";
import { recordingFixture } from "../fixtures/recording.ts";

for (const width of [390, 1440]) {
  test(`pinned counters stay above GPU lanes and preserve sample age at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/examples/viewer/");
    await page.getByLabel("Open recording or comparison").setInputFiles({
      name: "counters.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recordingFixture())),
    });
    await page.getByText("PIN COUNTERS", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Pin physics / bodies", exact: true }).check();
    const pinned = page.locator("[data-pinned-counter-lanes]");
    await expect(pinned.locator('[data-lane-kind="counter"]')).toHaveCount(1);
    await expect(page.locator("[data-counter-lane-heading]")).toBeHidden();
    await expect(page.locator("[data-pinned-counter-readout]")).toContainText("Unknown");
    await page.getByText("PIN COUNTERS", { exact: true }).click();
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await expect(page.locator("[data-pinned-counter-readout]")).toContainText("6.00 ms old");
    await expect(
      page.locator("[data-pinned-counter-readout] .jank-viewer-counter-value"),
    ).toHaveText("3");
    const positions = await page.evaluate(() => ({
      pin: document.querySelector("[data-pinned-counter-lanes]")?.getBoundingClientRect().top,
      cpu: document.querySelector('[data-lane-kind="cpu"]')?.getBoundingClientRect().top,
    }));
    expect(positions.pin).toBeLessThan(positions.cpu ?? 0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByText("PIN COUNTERS", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Pin physics / bodies", exact: true }).uncheck();
    await expect(page.locator("[data-pinned-counter-readout]")).toBeHidden();
    await expect(pinned).toHaveCount(0);
    await expect(page.locator("[data-counter-lane-heading]")).toBeVisible();
  });
}

test("A/B pins share alignment, retain invalid samples and clear on replacement", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const file = {
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(counterComparisonFixture())),
  };
  await page.getByLabel("Open recording or comparison").setInputFiles(file);
  await page.getByText("PIN COUNTERS", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Pin renderer / drawCalls", exact: true }).check();
  await page.getByText("PIN COUNTERS", { exact: true }).click();
  const values = page.locator("[data-pinned-counter-readout] .jank-viewer-counter-value");
  await expect(values).toHaveText(["10", "20"]);
  await page.getByText("VIEW", { exact: true }).click();
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).fill("100");
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).press("Enter");
  await expect(values).toHaveText(["Unknown", "Unknown"]);
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).fill("400");
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).press("Enter");
  await expect(values).toHaveText(["0", "0"]);
  await page.getByText("VIEW", { exact: true }).click();
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("3");
  await expect(page.locator("[data-pinned-counter-lanes]")).toHaveCount(1);
  await page.getByLabel("Open recording or comparison").setInputFiles(file);
  await expect(page.locator("[data-pinned-counter-readout]")).toBeHidden();
  await expect(page.locator("[data-pinned-counter-lanes]")).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`@visual pinned counter evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/examples/viewer/");
    await page.getByLabel("Open recording or comparison").setInputFiles({
      name: "counters.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recordingFixture())),
    });
    await page.getByText("PIN COUNTERS", { exact: true }).click();
    await page.getByRole("checkbox", { name: "Pin physics / bodies", exact: true }).check();
    await page.getByText("PIN COUNTERS", { exact: true }).click();
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await page.mouse.move(0, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page).toHaveScreenshot(`counter-pins-${width}.png`, { fullPage: true });
  });
}
