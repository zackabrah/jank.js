import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { gpuIntervalFixture } from "../fixtures/gpu-sample.ts";
import { recordingFixture } from "../fixtures/recording.ts";

test("repeated GPU invocations collapse by stable pass identity and retain unknown rows", async ({
  page,
}) => {
  const recording = { ...recordingFixture(), gpu: [gpuIntervalFixture()] };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "groups.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  const timeline = page.locator('[data-timeline-lanes="single"]');
  const group = timeline.locator("details[data-gpu-group]");
  await expect(group).toHaveCount(1);
  await expect(group.locator("summary")).toContainText("Ocean FFT · 2 invocation rows");
  await expect(group.locator("[data-lane-kind]").first()).toBeHidden();
  await group.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(group.locator("[data-lane-kind]").first()).toBeVisible();
  const inspector = page.locator("[data-inspector-gpu] details[data-gpu-group]");
  await expect(inspector.locator("summary")).toContainText("6.00 ms observed sum");
  await inspector.locator("summary").click();
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(group).toHaveAttribute("open", "");
  await expect(inspector).toHaveAttribute("open", "");
  await expect(inspector.locator("summary")).toContainText("Unknown · 0/2 rows observed");
  await expect(inspector.locator("tbody tr")).toHaveCount(2);
  await expect(group.locator("[data-lane-readout]").first()).toHaveText("—");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "replacement.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(group).not.toHaveAttribute("open");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`@visual grouped GPU evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const recording = { ...recordingFixture(), gpu: [gpuIntervalFixture()] };
    await page.goto("/examples/viewer/");
    await page.getByLabel("Open recording or comparison").setInputFiles({
      name: "groups.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recording)),
    });
    await page.locator("[data-inspector-gpu] summary").click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page).toHaveScreenshot(`gpu-groups-${width}.png`, { fullPage: true });
  });
}

test("same labels do not merge different GPU IDs or pass types", async ({ page }) => {
  const sample = gpuIntervalFixture();
  const recording = {
    ...recordingFixture(),
    gpu: [
      {
        ...sample,
        passes: sample.passes.map((pass) => ({
          ...pass,
          label: "Same label",
          id: pass.invocation === 3 ? "different" : "fft",
        })),
      },
    ],
  };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "identities.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(page.locator('[data-timeline-lanes="single"] [data-lane-kind="gpu"]')).toHaveCount(
    3,
  );
  await expect(page.locator("details[data-gpu-group]")).toHaveCount(0);
});

test("B-only GPU group expansion survives comparison frame navigation", async ({ page }) => {
  const report = comparisonReportFixture();
  const comparison = {
    ...report,
    trials: report.trials.map((trial) => ({
      ...trial,
      recording: { ...trial.recording, gpu: trial.variant === "B" ? [gpuIntervalFixture()] : [] },
    })),
  };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "b-only.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparison)),
  });
  const group = page.locator("[data-inspector-gpu] details[data-gpu-group]");
  await group.locator("summary").click();
  await expect(group.locator("summary")).toContainText("B 6.00 ms observed sum");
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(group).toHaveAttribute("open", "");
});
