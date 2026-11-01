import AxeBuilder from "@axe-core/playwright";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { recordingFixture } from "../fixtures/recording.ts";
import { expect, test } from "../fixtures/visual-test.ts";

const file = (value: unknown, name = "comparison.json") => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});
test("opens a comparison, recalculates results and drills into the selected trial's CPU/GPU frames", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(comparisonReportFixture()));
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  await expect(page.getByRole("table", { name: "A/B results" })).toContainText("Mixed results");
  await expect(page.getByRole("table", { name: "A/B results" })).toContainText("Unknown");
  await expect(page.getByRole("table", { name: "Scene settings" })).toContainText("800 × 600");
  await expect(page.getByRole("table", { name: "Scene settings" })).toContainText("400 × 600");
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("1");
  await expect(page.locator("[data-viewer-evidence]")).toContainText("GPU samples 60%");
  await page.getByText("FRAME DETAILS", { exact: true }).click();
  await page.getByLabel("Frame position", { exact: true }).fill("40");
  await page.getByLabel("Frame position", { exact: true }).press("Enter");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #40");
  await expect(page.locator("[data-viewer-gpu]")).toContainText("No GPU observation");
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("0");
  await expect(page.locator("[data-viewer-gpu]")).toContainText("Ocean FFT");
  await expect(page.locator("[data-viewer-cpu]")).toContainText("Physics");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("failed imports preserve the selected recording and labels remain text", async ({ page }) => {
  await page.goto("/examples/viewer/");
  const recording = recordingFixture();
  const malicious = {
    ...recording,
    channels: [{ id: "physics", label: '<img src=x onerror="window.hacked=true">' }],
  };
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(malicious, "recording.json"));
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #2");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file({ format: "jank.js-comparison", version: 999 }));
  await expect(page.getByRole("alert")).toContainText("version 1");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #2");
  await expect(page.locator("[data-viewer-cpu] img")).toHaveCount(0);
});

test("keyboard navigation, chart selection and trial extraction use the current recording", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(comparisonReportFixture()));
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Next frame", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #2");
  await page.locator('[data-paired-chart="overlay"]').click({ position: { x: 2, y: 20 } });
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #1");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected recording" }).click();
  const downloaded = await downloading;
  const path = await downloaded.path();
  if (!path) {
    throw new Error("No recording downloaded");
  }
  const { readFile } = await import("node:fs/promises");
  const { parseRecording } = await import("../../packages/jank/src/index.ts");
  const parsed = parseRecording(await readFile(path, "utf8"));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.recording.frames[0]?.cpu.updateMs).toBe(6);
  }
});
test("empty/cancelled reports and rejected GPU evidence remain explicit", async ({ page }) => {
  await page.goto("/examples/viewer/");
  const report = comparisonReportFixture();
  const unknownResolution = {
    ...report,
    trials: report.trials.map((trial) => ({
      ...trial,
      context: { ...trial.context, resolution: null },
    })),
  };
  await page.getByLabel("Open recording or comparison").setInputFiles(file(unknownResolution));
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  const resolutionRow = page
    .getByRole("table", { name: "Scene settings" })
    .getByRole("row")
    .filter({ hasText: "Drawing resolution" });
  await expect(resolutionRow.getByRole("cell").last()).toHaveText("Unknown");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file({ ...report, status: "cancelled", trials: [] }));
  await expect(page.getByRole("table", { name: "A/B results" })).toContainText("Unknown");
  await expect(page.getByRole("button", { name: "Export selected recording" })).toBeDisabled();
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file({ ...recordingFixture(), frames: [], gpu: [], counters: [], events: [] }));
  await expect(page.locator("[data-viewer-frame]")).toContainText("No sealed frames");
  const { gpuIntervalFixture } = await import("../fixtures/gpu-sample.ts");
  const sample = gpuIntervalFixture();
  const pass = sample.passes[0];
  if (!pass) {
    throw new Error("Missing GPU pass");
  }
  const rejected = {
    ...sample,
    passes: sample.passes.slice(1),
    rejectedPasses: [{ ...pass, reason: "zero-timestamp", startNs: "0", endNs: "0" }],
    omittedPasses: 1,
    completeness: "incomplete",
    issues: ["zero-timestamp"],
    metrics: null,
  };
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file({ ...recordingFixture(), gpu: [rejected] }));
  await expect(page.locator("[data-viewer-gpu]")).toContainText("Rejected: zero-timestamp");
  await expect(page.locator("[data-viewer-gpu]")).toContainText("Raw ns: 0 / 0");
  await expect(page.locator("[data-viewer-gpu]")).toContainText("GPU busy Unknown");
});
test("API snapshots detach data and stale file reads cannot replace newer loads or survive disposal", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const result = await page.evaluate(async (recording) => {
    const path = "/packages/jank/src/index.ts";
    const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
    const container = document.createElement("div");
    document.body.append(container);
    const viewer = api.createViewer({ container });
    const pending = Promise.withResolvers<string>();
    const delayed = new File(["{}"], "delayed.json", { type: "application/json" });
    Object.defineProperty(delayed, "text", { value: () => pending.promise });
    const transfer = new DataTransfer();
    transfer.items.add(delayed);
    const input = container.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) {
      throw new Error("Missing input");
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    viewer.load(recording);
    viewer.selectFrame(2);
    pending.resolve(
      JSON.stringify({ ...recording, frames: [], counters: [], events: [], gpu: [] }),
    );
    await Promise.resolve();
    await Promise.resolve();
    const state = viewer.snapshot();
    const selected = state.status === "loaded" ? state.selectedFrameId : null;
    if (state.status === "loaded" && state.recording) {
      Object.assign(state.recording.frames[0]?.cpu ?? {}, { renderMs: 999 });
    }
    const snapshot = viewer.snapshot();
    const detached =
      snapshot.status === "loaded" && snapshot.recording?.frames[0]?.cpu.renderMs === 2;
    viewer.dispose();
    viewer.dispose();
    viewer.load(recording);
    return {
      selected,
      detached,
      children: container.childElementCount,
      status: viewer.snapshot().status,
    };
  }, recordingFixture());
  expect(result).toEqual({ selected: 2, detached: true, children: 0, status: "empty" });
});

for (const width of [1280, 390]) {
  test(`@visual viewer comparison and frame evidence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/examples/viewer/");
    await page
      .getByLabel("Open recording or comparison")
      .setInputFiles(file(comparisonReportFixture()));
    await expect(page.locator("[data-viewer-mixed]")).toBeVisible();
    await expect(page.locator(".jank-viewer")).toHaveScreenshot(`viewer-comparison-${width}.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
