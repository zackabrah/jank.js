import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { viewerReferenceFixture } from "../fixtures/viewer-reference.ts";

const artifact = resolve("artifacts/jank-viewer.html");
test.beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-standalone.mjs", "viewer"], { stdio: "pipe" });
});
test("standalone viewer imports a comparison offline without requesting network resources", async ({
  page,
  browserName,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) {
      requests.push(request.url());
    }
  });
  await page.route(/^https?:/, (route) => route.abort());
  if (browserName !== "webkit") {
    await page.context().setOffline(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(artifact).href);
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonReportFixture())),
  });
  await expect(page.locator("[data-viewer-mixed]")).toContainText("Mixed results: CPU");
  await expect(page.locator("[data-viewer-gpu]")).toContainText("Ocean FFT");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  const rowHeights = await page
    .locator("[data-viewer-results] tbody tr, [data-viewer-trials] tbody tr")
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  expect(Math.max(...rowHeights)).toBeLessThan(160);
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "captures.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(viewerReferenceFixture())),
  });
  await expect(page.locator("[data-capture-list] tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Open capture 2", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#168");
  expect(requests).toEqual([]);
  expect(readFileSync(artifact, "utf8")).not.toMatch(
    /<script[^>]+src=|<link[^>]+rel=["']stylesheet|@import\s/,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
