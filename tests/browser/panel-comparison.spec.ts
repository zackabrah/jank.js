import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";

test("panel runs paired captures, shows measurements and downloads all trial recordings", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    const revoke = URL.revokeObjectURL.bind(URL);
    document.body.dataset.revocations = "0";
    URL.revokeObjectURL = (url) => {
      document.body.dataset.revocations = String(Number(document.body.dataset.revocations) + 1);
      revoke(url);
    };
  });
  await page.getByLabel("Warm-up seconds", { exact: true }).fill("0.5");
  await page.getByLabel("Measurement seconds", { exact: true }).fill("1");
  await page.getByLabel("Pairs", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop comparison", exact: true })).toBeFocused();
  await page.evaluate(() => window.comparisonFixture.advance(550));
  await expect(page.locator("[data-comparison-status]")).toContainText("Comparison complete");
  await expect(page.getByRole("button", { name: "Export comparison", exact: true })).toBeFocused();
  await expect(page.locator("[data-comparison-trials] > details")).toHaveCount(4);
  await expect(page.locator("[data-comparison-summary]")).toContainText("CPU median");
  await expect(page.locator("[data-comparison-summary]")).toContainText("GPU comparison: unknown");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison", exact: true }).click();
  const path = await (await downloading).path();
  if (!path) {
    throw new Error("Missing comparison download");
  }
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.format).toBe("jank.js-comparison");
  expect(report.trials.map((trial: { variant: string }) => trial.variant)).toEqual([
    "A",
    "B",
    "B",
    "A",
  ]);
  for (const trial of report.trials) {
    expect(parseRecording(JSON.stringify(trial.recording)).ok).toBe(true);
    expect(trial.context.resolution.widthPx).toBe(800);
  }
  expect(await page.evaluate(() => window.comparisonFixture.restored())).toBe(1);
  expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  const nextDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT JSON", exact: true }).click();
  await nextDownload;
  await expect(page.locator("body")).toHaveAttribute("data-revocations", "1");
});

async function mount(page: Page): Promise<void> {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(async () => {
    const path = "/tests/fixtures/panel/comparison.ts";
    const fixture: typeof import("../fixtures/panel/comparison.ts") = await import(path);
    fixture.mountComparisonFixture();
  });
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByText("A/B COMPARISON", { exact: true }).click();
}

test("stop, clear and panel disposal restore the host and release recording controls", async ({
  page,
}) => {
  for (const action of ["stop", "clear", "dispose"] as const) {
    await mount(page);
    await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
    await page.evaluate(() => window.comparisonFixture.advance(80));
    await expect(page.getByRole("button", { name: "Stop comparison", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Pairs", { exact: true })).toBeDisabled();
    if (action === "stop") {
      await page.getByRole("button", { name: "Stop comparison", exact: true }).click();
      await expect(page.getByLabel("Pairs", { exact: true })).toBeEnabled();
    } else if (action === "clear") {
      await page.getByRole("tab", { name: "LIVE", exact: true }).click();
      await expect(page.getByRole("button", { name: "STOP REC", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "CLEAR", exact: true }).click();
      await expect(page.getByRole("button", { name: "REC", exact: true })).toBeEnabled();
    } else {
      await page.evaluate(() => window.comparisonFixture.dispose());
      await expect(page.locator(".jank")).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.comparisonFixture.restored())).toBe(1);
  }
});
test("@visual comparison controls and paired results fit a narrow panel", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mount(page);
  await page.getByLabel("Warm-up seconds", { exact: true }).fill("0.5");
  await page.getByLabel("Measurement seconds", { exact: true }).fill("1");
  await page.getByLabel("Pairs", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await page.evaluate(() => window.comparisonFixture.advance(550));
  await page.locator('[data-tabpanel="capture"]').evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.locator(".jank")).toHaveScreenshot("panel-comparison-narrow.png", {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  });
});
