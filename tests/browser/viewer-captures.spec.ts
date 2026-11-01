import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { parseRecording } from "../../packages/jank/src/recordings/codec.ts";
import { comparisonReportFixture } from "../fixtures/comparison-report.ts";
import { viewerReferenceFixture } from "../fixtures/viewer-reference.ts";
import { expect, test } from "../fixtures/visual-test.ts";

const file = (value: unknown) => ({
  name: "captures.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});

test("capture list and overview markers navigate ranked spikes and export the selected context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/examples/viewer/");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(viewerReferenceFixture()));
  await expect(page.locator("[data-capture-list] tbody tr")).toHaveCount(3);
  await expect(page.locator("[data-capture-rule]")).toContainText("Detected spikes");
  await expect(page.locator("[data-session-markers] button")).toHaveCount(3);
  await page.getByRole("button", { name: "Open capture 2", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#168");
  await page.getByRole("button", { name: "Next capture", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#336");
  await page.getByRole("button", { name: "Next capture", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#243");
  await page.getByRole("button", { name: "Overview capture 2", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#168");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected capture", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) {
    throw new Error("No capture file");
  }
  const parsed = parseRecording(await readFile(path, "utf8"));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.recording.frames[0]?.id).toBe(48);
    expect(parsed.recording.frames.at(-1)?.id).toBe(288);
    expect(parsed.recording.truncated).toBe(false);
  }
  await page.getByRole("button", { name: "Overview capture 3", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#336");
  await expect(page.locator("[data-capture-selection]")).toContainText("clipped");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("automatic files retain their recorded trigger and comparison trials replace capture evidence", async ({
  page,
}) => {
  const recording = viewerReferenceFixture();
  const automatic = {
    ...recording,
    capture: {
      kind: "automatic",
      triggerFrameId: 168,
      thresholdMs: 40,
      beforeFrames: 167,
      afterFrames: 192,
    },
  };
  await page.goto("/examples/viewer/");
  const input = page.getByLabel("Open recording or comparison");
  await input.setInputFiles(file(automatic));
  await expect(page.locator("[data-capture-list] tbody tr")).toHaveCount(1);
  await expect(page.locator("[data-capture-rule]")).toContainText("Recorded automatic trigger");
  await page.getByRole("button", { name: "Open capture 1", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#168");
  await input.setInputFiles(file(comparisonReportFixture()));
  await expect(page.locator("[data-capture-list]")).toContainText("No capture spikes");
  await expect(page.locator("[data-session-markers] button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export selected capture", exact: true }),
  ).toBeDisabled();
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("1");
  await expect(page.locator("[data-capture-rule]")).toContainText("trial B");
  await expect(page.locator("[data-capture-list] tbody tr")).toHaveCount(0);
});

test("A/B capture markers follow the active trial's elapsed origin and preserve selection after failed export", async ({
  page,
}) => {
  const report = comparisonReportFixture();
  const trials = report.trials.map((trial) => {
    if (trial.variant === "A") {
      return trial;
    }
    const recording = trial.recording;
    return {
      ...trial,
      recording: {
        ...recording,
        frames: recording.frames
          .filter((frame) => frame.id !== 11 && frame.id !== 12)
          .map((frame) => ({
            ...frame,
            startedAtMs: frame.startedAtMs + 5000,
            endedAtMs: (frame.id === 10 ? 240 : frame.endedAtMs) + 5000,
            scopes: frame.scopes.map((scope) => ({
              ...scope,
              startedAtMs: scope.startedAtMs + 5000,
              endedAtMs: scope.endedAtMs + 5000,
            })),
          })),
        counters: [],
        events: [],
        gpu: recording.gpu.filter((sample) => sample.frameId !== 11 && sample.frameId !== 12),
      },
    };
  });
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles(file({ ...report, trials }));
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("1");
  const marker = page.getByRole("button", { name: "Overview capture 1", exact: true });
  await expect(marker).toHaveAttribute("style", /18%/);
  await marker.click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#10");
  await expect(page.locator('[data-paired-frame="a"]')).toContainText("#10");
  await page.getByRole("checkbox", { name: "Show B", exact: true }).uncheck();
  await expect(marker).toBeHidden();
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("Download unavailable");
    };
  });
  await page.getByRole("button", { name: "Export selected capture", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Download unavailable");
  await expect(page.locator("[data-viewer-frame]")).toContainText("#10");
  await expect(page.locator("[data-capture-list] tbody tr")).toHaveCount(1);
});

test("@visual capture review remains accessible at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/examples/viewer/");
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles(file(viewerReferenceFixture()));
  await page.getByRole("button", { name: "Open capture 1", exact: true }).click();
  await expect(page.locator(".jank-viewer")).toHaveScreenshot("viewer-captures-390.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
