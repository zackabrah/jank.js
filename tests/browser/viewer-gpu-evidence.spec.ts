import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { gpuIntervalFixture } from "../fixtures/gpu-sample.ts";
import { recordingFixture } from "../fixtures/recording.ts";

test("partial GPU evidence stays useful without claiming a complete frame total", async ({
  page,
}) => {
  const sample = gpuIntervalFixture();
  const rejected = sample.passes[2];
  if (!rejected) {
    throw new Error("Missing pass fixture");
  }
  const recording = {
    ...recordingFixture(),
    gpu: [
      {
        ...sample,
        passes: sample.passes.slice(0, 2),
        omittedPasses: 1,
        rejectedPasses: [{ ...rejected, startNs: "9", endNs: "7", reason: "reversed-timestamp" }],
        completeness: "incomplete",
        metrics: null,
        issues: ["reversed-timestamp"],
      },
      {
        ...sample,
        frameId: 2,
        sequence: 2,
        passes: [],
        expectedPasses: 0,
        completeness: "incomplete",
        metrics: null,
        issues: ["sampled-out"],
      },
    ],
  };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "partial.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(page.locator("[data-viewer-coverage]")).toContainText(
    "GPU 1/2 sampled · 1 with timing · 0 complete",
  );
  await page.getByText("GPU coverage & timestamp evidence", { exact: true }).click();
  await expect(page.locator("[data-viewer-gpu-evidence]")).toContainText(
    "2 valid / 3 retained timestamp pairs · 1 rejected",
  );
  await expect(page.locator("[data-viewer-gpu-evidence]")).toContainText(
    "1 frames deliberately sampled out",
  );
  await expect(page.locator("[data-inspector-gpu]")).toContainText("4.00");
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(page.locator("[data-inspector-gpu]")).not.toContainText("4.00");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
