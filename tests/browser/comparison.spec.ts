import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("A/B comparison completes paired trials, exports settings, and restores the demo", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.goto("/examples/basic/");
  await page.locator("#objects").selectOption("64");
  await page.locator("#cpu-load").selectOption("2");
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await page.getByText("A/B comparison", { exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByText("A/B COMPARISON", { exact: true }).click();
  await page.getByLabel("Warm-up seconds", { exact: true }).fill("0.5");
  await page.getByLabel("Measurement seconds", { exact: true }).fill("1");
  await page.getByLabel("Pairs", { exact: true }).fill("2");
  await page.getByRole("combobox", { name: "B resolution scale", exact: true }).selectOption("0.5");
  await page.getByLabel("B animate", { exact: true }).uncheck();
  const original = await page.locator("#scene").evaluate((canvas) => ({
    width: canvas.getAttribute("width"),
    height: canvas.getAttribute("height"),
  }));
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await expect(page.locator("[data-comparison-status]")).toContainText("Running");
  await expect(page.locator("#objects")).toBeDisabled();
  await expect(page.locator("#headroom-start")).toBeDisabled();
  await expect(page.locator('[data-action="comparison-stop"]')).toBeEnabled();
  await expect(page.locator("[data-comparison-status]")).toContainText("Comparison complete", {
    timeout: 30000,
  });
  await expect(page.locator("[data-comparison-trials] > details")).toHaveCount(4);
  await expect(page.locator("#objects")).toBeEnabled();
  await expect(page.locator("#objects")).toHaveValue("64");
  await expect(page.locator("#cpu-load")).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Resume motion", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await expect(
    page
      .locator('[data-list="counters"] .jank-row')
      .filter({ hasText: "objects" })
      .locator("span")
      .last(),
  ).toHaveText("64");
  expect(
    await page.locator("#scene").evaluate((canvas) => ({
      width: canvas.getAttribute("width"),
      height: canvas.getAttribute("height"),
    })),
  ).toEqual(original);
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) {
    throw new Error("Missing comparison download");
  }
  const report = JSON.parse(readFileSync(path, "utf8"));
  expect(report.format).toBe("jank.js-comparison");
  expect(report.trials[1].context.animation).toBe("Frozen at time zero");
  expect(report.trials.map((trial: { variant: string }) => trial.variant)).toEqual([
    "A",
    "B",
    "B",
    "A",
  ]);
  expect(report.trials[1].context.resolution.widthPx).toBeLessThan(
    report.trials[0].context.resolution.widthPx,
  );
  expect(report.trials[0].context.settings).toContainEqual({
    label: "GPU",
    value: "WebGL2 elapsed scene render",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.locator("#demo-error")).toBeHidden();
});

test("stopping and resizing retain partial evidence without claiming a winner", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  await page.getByText("Sources & files", { exact: true }).click();
  await page.getByRole("combobox", { name: "GPU timing", exact: true }).selectOption("synthetic");
  await page.getByText("A/B comparison", { exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByText("A/B COMPARISON", { exact: true }).click();
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await page.getByRole("button", { name: "Stop comparison", exact: true }).click();
  await expect(page.locator("[data-comparison-status]")).toContainText("Stopped by user");
  await expect(page.locator("#gpu-example")).toHaveValue("synthetic");
  await expect(page.locator("[data-comparison-summary]")).toContainText("unknown");
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-comparison-status]")).toContainText("Viewport changed");
  await expect(page.locator('[data-action="comparison-start"]')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("recording blocks a comparison and unavailable GPU timings stay unknown", async ({ page }) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    WebGL2RenderingContext.prototype.getExtension = new Proxy(
      WebGL2RenderingContext.prototype.getExtension,
      {
        apply(target, receiver, args) {
          return args[0] === "EXT_disjoint_timer_query_webgl2"
            ? null
            : Reflect.apply(target, receiver, args);
        },
      },
    );
  });
  await page.goto("/examples/basic/");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.getByText("A/B comparison", { exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByText("A/B COMPARISON", { exact: true }).click();
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await expect(page.locator(".jank [role=alert]")).toContainText("Stop or disarm");
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.getByRole("button", { name: "STOP REC", exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Warm-up seconds", { exact: true }).fill("0.5");
  await page.getByLabel("Measurement seconds", { exact: true }).fill("1");
  await page.getByLabel("Pairs", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await expect(page.locator("[data-comparison-status]")).toContainText("Comparison complete", {
    timeout: 30000,
  });
  await expect(page.locator("[data-comparison-summary]")).toContainText("GPU comparison: unknown");
  const trials = page.locator("[data-comparison-trials] > details");
  await expect(trials).toHaveCount(4);
  for (const trial of await trials.all()) {
    await expect(trial).toContainText("GPU coverage 0%");
  }
  await expect(page.locator("#archive-count")).toHaveText("5");
});
