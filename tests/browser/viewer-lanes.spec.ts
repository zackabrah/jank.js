import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";

test("missing hover measurements do not change lane positions", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const report = comparisonReportFixture();
  const trials = report.trials.map((trial) => ({
    ...trial,
    recording: {
      ...trial.recording,
      frames: trial.recording.frames.filter((frame) => trial.variant !== "B" || frame.id !== 40),
      gpu: trial.recording.gpu.filter((sample) => trial.variant !== "B" || sample.frameId !== 40),
    },
  }));
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "gap.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...report, trials })),
  });
  const row = page.locator('[data-timeline-lanes="b"] [data-lane-kind="cpu"]');
  const plot = page.locator('[data-timeline-lanes="a"] [data-lane-kind="cpu"] svg');
  await plot.scrollIntoViewIfNeeded();
  const before = await row.boundingBox();
  const bounds = await plot.boundingBox();
  if (!before || !bounds) {
    throw new Error("Missing lane bounds");
  }
  await page.mouse.move(bounds.x + bounds.width * 0.785, bounds.y + 10);
  await expect(row).toContainText("No frame in this window");
  expect((await row.boundingBox())?.height).toBe(before.height);
});

test("lanes keep order and missing GPU gaps while hover, zoom, scrolling and event selection stay linked", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonReportFixture())),
  });
  const left = page.locator('[data-timeline-lanes="a"]');
  const right = page.locator('[data-timeline-lanes="b"]');
  await expect(left.locator("[data-lane-name]")).toHaveCount(4);
  const order = await left.locator("[data-lane-name]").allTextContents();
  await expect(right.locator('[data-lane-kind="gpu"]').first().locator("rect")).toHaveCount(30);
  const plot = left.locator('[data-lane-kind="cpu"] svg');
  await plot.scrollIntoViewIfNeeded();
  const bounds = await plot.boundingBox();
  if (!bounds) {
    throw new Error("Missing lane plot");
  }
  await page.mouse.move(bounds.x + bounds.width * 0.785, bounds.y + 10);
  await expect(right.locator("[data-lane-readout]").first()).toContainText("Hover");
  await expect(right.locator('[data-lane-kind="gpu"]').first()).toContainText("Unknown");
  await expect(page.getByLabel("Comparison elapsed time (ms)", { exact: true })).toHaveValue("0");
  await page.mouse.click(bounds.x + bounds.width * 0.785, bounds.y + 10);
  await expect(page.locator('[data-paired-frame="b"]')).toContainText("Frame #40");
  await page.getByRole("button", { name: "Zoom in comparison", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Comparison window (ms)", exact: true }),
  ).toHaveValue("500");
  const scroll = page.getByRole("slider", { name: "Comparison horizontal scroll", exact: true });
  await scroll.focus();
  await scroll.press("Home");
  await expect(page.locator("[data-paired-range]")).toContainText("0.00–500.00");
  await page.getByRole("combobox", { name: "A timeline event", exact: true }).selectOption("120");
  await expect(page.getByLabel("Comparison elapsed time (ms)", { exact: true })).toHaveValue("120");
  expect(await left.locator("[data-lane-name]").allTextContents()).toEqual(order);
  await expect(left.locator("[data-event-marker]")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("single recording lanes support keyboard selection, wheel zoom and horizontal scrolling", async ({
  page,
}) => {
  const recording = comparisonReportFixture().trials[0]?.recording;
  if (!recording) {
    throw new Error("Missing recording");
  }
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "single.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...recording,
        events: [{ atMs: 125, label: "Inside frame", detail: null }],
      }),
    ),
  });
  const lane = page.locator('[data-timeline-lanes="single"] [data-lane-kind="cpu"] svg');
  await lane.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #2");
  await expect(lane).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #50");
  await page.keyboard.press("Home");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #1");
  await lane.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(page.getByRole("combobox", { name: "Frames shown", exact: true })).toHaveValue("50");
  await page.mouse.wheel(100, 0);
  await expect(page.getByLabel("Range start", { exact: true })).toHaveValue("11");
  await lane.click();
  await expect(page.getByLabel("Range start", { exact: true })).toHaveValue("11");
  await expect(page.locator('[data-timeline-lanes="single"] [data-event-marker]')).toHaveCount(0);
  const scroll = page.getByRole("slider", { name: "Recording horizontal scroll", exact: true });
  await scroll.focus();
  await scroll.press("Home");
  await expect(page.getByLabel("Range start", { exact: true })).toHaveValue("1");
  await page
    .getByRole("combobox", { name: "Recording timeline event", exact: true })
    .selectOption("125");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #7");
  await expect(
    page.locator('[data-timeline-lanes="single"] [data-lane-readout]').first(),
  ).toContainText("Selected 125.00 ms");
  await expect(
    page.getByRole("combobox", { name: "Recording timeline event", exact: true }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("comparison wheel zoom preserves its anchor and pan changes both windows without moving selection", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonReportFixture())),
  });
  const plot = page.locator('[data-timeline-lanes="b"] [data-lane-kind="cpu"] svg');
  await plot.hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(
    page.getByRole("combobox", { name: "Comparison window (ms)", exact: true }),
  ).toHaveValue("500");
  await expect(page.locator("[data-paired-range]")).toContainText("250.00–750.00");
  await page.mouse.wheel(1000, 0);
  await expect(page.locator("[data-paired-range]")).toContainText("500.00–1000.00");
  await expect(page.getByLabel("Comparison elapsed time (ms)", { exact: true })).toHaveValue("0");
  await expect(page.locator('[data-paired-chart="a"]')).toHaveAttribute(
    "aria-label",
    /500 to 1000 milliseconds/,
  );
  await expect(page.locator('[data-paired-chart="b"]')).toHaveAttribute(
    "aria-label",
    /500 to 1000 milliseconds/,
  );
  await plot.focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-paired-range]")).toContainText("0.00–500.00");
});
