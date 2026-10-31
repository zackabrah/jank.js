import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { counterComparisonFixture } from "../fixtures/counter-comparison.ts";

const file = (value: unknown) => ({
  name: "counters.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});

test("counter overlays share scale and origin, keep zero and signed samples, and retain rows through missing polls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(counterComparisonFixture()));
  const lanes = page.locator('[data-timeline-lanes="overlay"] [data-lane-kind="counter"]');
  await expect(lanes).toHaveCount(3);
  const lane = lanes.first();
  const order = await lanes.locator("[data-counter-name]").allTextContents();
  await expect(lane.locator('[data-series="a"] [data-counter-point]')).toHaveCount(4);
  await expect(lane.locator('[data-series="b"] [data-counter-point]')).toHaveCount(4);
  await expect(lane.locator('[data-counter-value="0"]')).toHaveCount(2);
  await expect(lane.locator('[data-counter-value="-10"]')).toHaveCount(1);
  const points = await lane
    .locator("[data-counter-point]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-elapsed-ms")));
  expect(points.filter((time) => time === "0")).toHaveLength(2);
  const initialRowHeight = (
    await page.locator("[data-counter-inspector] tbody tr").first().boundingBox()
  )?.height;
  const plot = lane.locator("svg");
  const bounds = await plot.boundingBox();
  if (!bounds) {
    throw new Error("Missing counter lane");
  }
  await page.mouse.move(bounds.x + bounds.width * 0.05, bounds.y + 10);
  const age = page
    .locator("[data-counter-inspector] tbody tr")
    .first()
    .locator("td")
    .nth(1)
    .locator("small");
  // Native pointer coordinates round to CSS pixels in Firefox/WebKit.
  await expect
    .poll(async () => Number.parseFloat((await age.textContent()) ?? ""))
    .toBeGreaterThan(48);
  expect(Number.parseFloat((await age.textContent()) ?? "")).toBeLessThan(52);
  await expect(page.locator("[data-counter-inspector]")).toContainText("10");
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + 10);
  await expect(page.locator("[data-counter-inspector]")).toContainText("Renderer unavailable");
  await expect(lane).toHaveClass(/jank-viewer-unknown/);
  expect(
    (await page.locator("[data-counter-inspector] tbody tr").first().boundingBox())?.height,
  ).toBe(initialRowHeight);
  expect(await lanes.locator("[data-counter-name]").allTextContents()).toEqual(order);
  await page.getByRole("checkbox", { name: "Show B", exact: true }).uncheck();
  await expect(lane.locator('[data-series="b"]')).toBeHidden();
  await plot.focus();
  await page.keyboard.press("ArrowRight");
  await expect(plot).toBeFocused();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#2");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("single counter lanes preserve sample ages when panning and clear on replacement", async ({
  page,
}) => {
  const recording = counterComparisonFixture().trials[0]?.recording;
  if (!recording) {
    throw new Error("Missing recording");
  }
  await page.goto("/examples/viewer/");
  const input = page.getByLabel("Open recording or comparison");
  await input.setInputFiles(file(recording));
  const lane = page.locator('[data-timeline-lanes="single"] [data-lane-kind="counter"]').first();
  await expect(lane).toBeVisible();
  await page.getByText("VIEW", { exact: true }).click();
  await page.getByLabel("Range start", { exact: true }).fill("36");
  await page.getByLabel("Range start", { exact: true }).press("Enter");
  await page.getByText("VIEW", { exact: true }).click();
  await expect(lane.locator("[data-counter-point]")).toHaveCount(0);
  await expect(lane.locator("[data-counter-scale]")).toHaveText("no samples");
  const bounds = await lane.locator("svg").boundingBox();
  if (!bounds) {
    throw new Error("Missing counter lane");
  }
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10);
  await expect(page.locator("[data-counter-inspector]")).toContainText("250.00 ms old");
  await input.setInputFiles(file({ ...recording, counters: [] }));
  await expect(
    page.locator('[data-timeline-lanes="single"] [data-lane-kind="counter"]'),
  ).toHaveCount(0);
  await expect(page.locator("[data-counter-inspector]")).toContainText("No numeric counters");
});

for (const width of [1440, 390]) {
  test(`@visual counter overlays at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/examples/viewer/");
    await page
      .getByLabel("Open recording or comparison")
      .setInputFiles(file(counterComparisonFixture()));
    await expect(page.locator('[data-lane-kind="counter"]')).toHaveCount(3);
    await expect(page.locator(".jank-viewer")).toHaveScreenshot(`viewer-counters-${width}.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("extreme signed counters retain finite graph coordinates", async ({ page }) => {
  const source = counterComparisonFixture().trials[0]?.recording;
  if (!source) {
    throw new Error("Missing recording");
  }
  const recording = {
    ...source,
    counters: [
      { atMs: 0, channelId: "renderer", status: "ready", values: { signed: Number.MAX_VALUE } },
      { atMs: 100, channelId: "renderer", status: "ready", values: { signed: -Number.MAX_VALUE } },
    ],
  };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles(file(recording));
  const points = page.locator('[data-lane-kind="counter"] circle');
  await expect(points).toHaveCount(2);
  expect(
    await points.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("cy")))),
  ).toEqual([2, 24]);
});
