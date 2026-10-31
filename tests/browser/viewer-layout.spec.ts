import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { recordingFixture } from "../fixtures/recording.ts";

test("the viewer uses the original compact desktop shell with a persistent right inspector", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "recording.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recordingFixture())),
  });
  const inspector = page.getByRole("complementary", { name: "Frame inspector" });
  await expect(inspector).toBeVisible();
  const bounds = await inspector.boundingBox();
  expect(bounds?.x).toBe(1000);
  expect(bounds?.width).toBe(440);
  expect(bounds?.y).toBe(168);
  expect(
    await page
      .locator(".jank-viewer-header")
      .evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(32);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
  await expect(page.locator("[data-session-chart]")).toBeVisible();
  await expect(page.locator("[data-inspector-cpu] tbody td").first()).toHaveText("Physics");
  await expect(page.locator('[data-timeline-lanes="single"] [data-lane-name]').first()).toHaveText(
    "Physics",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("A/B shares one chart and each lane, with different colors and dash patterns and optional evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonReportFixture())),
  });
  await expect(page.locator('[data-paired-chart="overlay"]')).toBeVisible();
  await expect(page.locator("[data-viewer-chart]")).toBeHidden();
  const lane = page.locator('[data-timeline-lanes="overlay"] [data-lane-kind="cpu"]');
  await expect(lane).toHaveCount(1);
  await expect(lane.locator('g[data-series="a"] rect')).toHaveCount(50);
  await expect(lane.locator('g[data-series="b"] rect')).toHaveCount(50);
  const styles = await lane.evaluate((node) => {
    const a = node.querySelector('g[data-series="a"] rect');
    const b = node.querySelector('g[data-series="b"] rect');
    if (!a || !b) {
      throw new Error("Missing overlay");
    }
    return {
      a: getComputedStyle(a).stroke,
      b: getComputedStyle(b).stroke,
      dash: getComputedStyle(b).strokeDasharray,
      ax: a.getAttribute("x"),
      bx: b.getAttribute("x"),
    };
  });
  expect(styles.a).not.toBe(styles.b);
  expect(styles.dash).not.toBe("none");
  expect(styles.ax).toBe(styles.bx);
  await page.getByRole("checkbox", { name: "Show B", exact: true }).uncheck();
  await expect(lane.locator('g[data-series="b"]')).toBeHidden();
  await expect(page.locator("[data-viewer-results]")).toBeHidden();
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  await expect(page.getByRole("table", { name: "A/B results", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("empty comparisons clear previous measurements and session selection follows the visible window", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const input = page.getByLabel("Open recording or comparison");
  const report = comparisonReportFixture();
  await input.setInputFiles({
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(report)),
  });
  await page.getByText("VIEW", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Comparison window (ms)", exact: true })
    .selectOption("250");
  await page.getByText("VIEW", { exact: true }).click();
  const overview = page.locator("[data-session-chart]");
  const bounds = await overview.boundingBox();
  if (!bounds) {
    throw new Error("Missing overview");
  }
  await overview.click({ position: { x: bounds.width * 0.785, y: 20 } });
  await expect(page.locator('[data-paired-frame="a"]')).toContainText("Frame #40");
  await expect(page.locator("[data-paired-range]")).toContainText("750.00–1000.00");
  await input.setInputFiles({
    name: "empty.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...report, status: "cancelled", trials: [] })),
  });
  await expect(page.locator("[data-viewer-duration]")).toHaveText("—");
  await expect(page.locator("[data-viewer-frame]")).toHaveText("No trial recording");
  await expect(page.locator("[data-viewer-environment]")).not.toContainText("Test host");
  await expect(page.locator("[data-inspector-cpu]")).not.toContainText("Physics");
});

test("@visual compact single recording matches the original viewer's geometry and density", async ({
  page,
}) => {
  const { viewerReferenceFixture } = await import("../fixtures/viewer-reference.ts");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "reference-scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(viewerReferenceFixture())),
  });
  await page.getByText("FRAME DETAILS", { exact: true }).click();
  await page.getByLabel("Frame position", { exact: true }).fill("243");
  await page.getByLabel("Frame position", { exact: true }).press("Enter");
  await page.getByText("FRAME DETAILS", { exact: true }).click();
  await page.getByText("VIEW", { exact: true }).click();
  await page.getByRole("combobox", { name: "Frames shown", exact: true }).selectOption("200");
  await page.getByLabel("Range start", { exact: true }).fill("144");
  await page.getByLabel("Range start", { exact: true }).press("Enter");
  await page.getByText("VIEW", { exact: true }).click();
  await expect(page.locator("[data-viewer-duration]")).toHaveText("66.60");
  await expect(page.locator(".jank-viewer")).toHaveScreenshot("viewer-original-layout-1440.png");
});
