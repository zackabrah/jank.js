import AxeBuilder from "@axe-core/playwright";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { recordingFixture } from "../fixtures/recording.ts";
import { expect, test } from "../fixtures/visual-test.ts";

test("linked elapsed selection compares work and preserves gaps, row order and keyboard access", async ({
  page,
}) => {
  const report = comparisonReportFixture();
  const trials = report.trials.map((trial) => ({
    ...trial,
    recording: {
      ...trial.recording,
      counters: [],
      events: [],
      frames: trial.recording.frames
        .map((frame) => ({
          ...frame,
          startedAtMs: frame.startedAtMs + (trial.variant === "B" ? 5000 : 0),
          endedAtMs: frame.endedAtMs + (trial.variant === "B" ? 5000 : 0),
          scopes: frame.scopes.map((scope) => ({
            ...scope,
            startedAtMs: scope.startedAtMs + (trial.variant === "B" ? 5000 : 0),
            endedAtMs: scope.endedAtMs + (trial.variant === "B" ? 5000 : 0),
          })),
        }))
        .filter((frame) => trial.variant !== "B" || frame.id !== 2),
      gpu: trial.recording.gpu.filter((sample) => trial.variant !== "B" || sample.frameId !== 2),
    },
  }));
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "paired.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...report, trials })),
  });
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  await page.getByText("VIEW", { exact: true }).click();
  await expect(page.getByRole("table", { name: "CPU scope comparison" })).toContainText("+2.00 ms");
  const names = await page.locator("[data-paired-cpu] tbody tr td:first-child").allTextContents();
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).fill("20");
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).press("Enter");
  await expect(page.locator('[data-paired-frame="a"]')).toContainText("Frame #2");
  await expect(page.locator('[data-paired-frame="b"]')).toContainText("No frame");
  await expect(page.getByRole("table", { name: "CPU scope comparison" })).toContainText("Unknown");
  expect(await page.locator("[data-paired-cpu] tbody tr td:first-child").allTextContents()).toEqual(
    names,
  );
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).fill("780");
  await page.getByLabel("Comparison elapsed time (ms)", { exact: true }).press("Enter");
  await expect(page.locator('[data-paired-frame="b"]')).toContainText("Frame #40");
  await expect(page.getByRole("table", { name: "GPU pass comparison" })).toContainText(
    "No GPU observation",
  );
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("3");
  await expect(page.getByLabel("Comparison elapsed time (ms)", { exact: true })).toHaveValue("780");
  await expect(page.getByRole("table", { name: "CPU scope comparison" })).toContainText("−2.00 ms");
  await page
    .getByRole("combobox", { name: "Comparison window (ms)", exact: true })
    .selectOption("250");
  await expect(page.locator("[data-paired-range]")).toContainText("750.00–1000.00 ms");
  await page.getByText("VIEW", { exact: true }).click();
  await page.locator('[data-paired-chart="overlay"]').click({ position: { x: 2, y: 20 } });
  await expect(page.locator("[data-viewer-frame]")).toContainText("Frame #38");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("paired API preserves selection on errors and resets on replacement or disposal", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const result = await page.evaluate(
    async ({ report, recording }) => {
      const path = "/packages/jank/src/index.ts";
      const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
      const container = document.createElement("div");
      document.body.append(container);
      const viewer = api.createViewer({ container });
      viewer.loadComparison(report);
      viewer.selectComparisonTime(780);
      viewer.selectTrial(1);
      const state = viewer.snapshot();
      let rejected = false;
      try {
        viewer.selectComparisonTime(-1);
      } catch {
        rejected = true;
      }
      const invalid = viewer.import("{}");
      const retained = viewer.snapshot();
      viewer.selectComparisonTime(1000);
      const end = viewer.snapshot();
      viewer.load(recording);
      const reset = viewer.snapshot();
      const hidden = container.querySelector<HTMLElement>("[data-viewer-comparison]")?.hidden;
      viewer.dispose();
      viewer.selectComparisonTime(10);
      return {
        state:
          state.status === "loaded"
            ? [state.comparisonElapsedMs, state.selectedTrialIndex, state.selectedFrameId]
            : null,
        retained: retained.status === "loaded" ? retained.comparisonElapsedMs : null,
        end: end.status === "loaded" ? end.selectedFrameId : -1,
        reset: reset.status === "loaded" ? reset.comparisonElapsedMs : null,
        rejected,
        invalid: invalid.ok,
        hidden,
        children: container.childElementCount,
      };
    },
    { report: comparisonReportFixture(), recording: recordingFixture() },
  );
  expect(result).toEqual({
    state: [780, 1, 40],
    retained: 780,
    end: null,
    reset: 0,
    rejected: true,
    invalid: false,
    hidden: true,
    children: 0,
  });
});

test("missing partner stays unknown and opening a single recording hides paired controls", async ({
  page,
}) => {
  const report = comparisonReportFixture();
  await page.goto("/examples/viewer/");
  const input = page.getByLabel("Open recording or comparison");
  await input.setInputFiles({
    name: "partial.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...report, status: "cancelled", trials: report.trials.slice(0, 1) }),
    ),
  });
  await expect(page.locator('[data-paired-title="b"]')).toContainText("trial unavailable");
  await page.getByText("COMPARISON DETAILS", { exact: true }).click();
  await expect(page.getByRole("table", { name: "GPU pass comparison" })).toContainText("Unknown");
  await input.setInputFiles({
    name: "no-gpu.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...report,
        trials: report.trials.map((trial) => ({
          ...trial,
          recording: { ...trial.recording, gpu: [] },
        })),
      }),
    ),
  });
  await expect(page.locator("[data-paired-gpu]")).toContainText(
    "No GPU pass identities were recorded. Timing is unknown.",
  );
  await input.setInputFiles({
    name: "single.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recordingFixture())),
  });
  await expect(
    page.getByRole("region", { name: "Synchronized A/B inspection", exact: true }),
  ).toBeHidden();
});

for (const width of [1280, 390]) {
  test(`@visual paired frame comparison at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/examples/viewer/");
    await page.getByLabel("Open recording or comparison").setInputFiles({
      name: "comparison.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(comparisonReportFixture())),
    });
    await expect(page.getByRole("table", { name: "CPU selected work" })).toContainText("+2.00");
    await expect(page.locator("[data-paired-section]")).toHaveScreenshot(
      `paired-inspection-${width}.png`,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
