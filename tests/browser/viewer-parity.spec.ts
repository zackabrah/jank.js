import { expect, test } from "@playwright/test";
import { viewerReferenceFixture } from "../fixtures/viewer-reference.ts";

const file = () => ({
  name: "parity.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(viewerReferenceFixture())),
});

test("reference shortcuts jump ten frames and cycle captures without stealing input keys", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles(file());
  const lane = page.locator("[data-lane-surface]").first();
  await lane.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#11");
  await page.keyboard.press("]");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#243");
  await page.keyboard.press("]");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#168");
  await page.keyboard.press("[");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#243");
  await expect(lane).toBeFocused();
  await page.getByText("FRAME DETAILS", { exact: true }).click();
  await page.getByLabel("Frame position", { exact: true }).focus();
  await page.keyboard.press("]");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#243");
});

test("dragging the session range pans without turning the release into a frame selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles(file());
  const chart = page.locator("[data-session-chart]");
  const bounds = await chart.boundingBox();
  if (!bounds) {
    throw new Error("Missing session chart");
  }
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + 25, { steps: 6 });
  await page.mouse.up();
  expect(Number(await page.locator("[data-viewer-range-start]").inputValue())).toBeGreaterThan(100);
  await expect(page.locator("[data-viewer-frame]")).toContainText("#1");
  await chart.click({ position: { x: bounds.width * 0.8, y: 25 } });
  await expect(page.locator("[data-viewer-frame]")).not.toContainText("Frame #1");
});

test("frame context and the likely scope stay visible in the compact inspector and timeline", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles(file());
  await expect(page.locator('[data-lane-kind="frame"] [data-lane-name]')).toHaveText([
    "unattributed",
    "profiler ×20",
  ]);
  await page.locator('[data-capture-action="open"]').first().click();
  const cpu = page.locator("[data-inspector-cpu]");
  await expect(cpu).toContainText("unattributed");
  await expect(cpu).toContainText("profiler");
  await expect(cpu.locator("[data-likely-scope]")).toContainText("scene update");
  const rows = page.locator('[data-lane-kind="frame"]');
  const heights = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  );
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)),
  ).toEqual(heights);
});
