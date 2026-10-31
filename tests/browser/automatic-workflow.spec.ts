import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { recordingFixture } from "../fixtures/recording.ts";

test("LIVE arms the existing default, applies budget presets explicitly and inspects saved context", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  const toggle = page.getByRole("button", { name: "Capture slow frames", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  expect(
    await page.evaluate(() => window.panelFixture.profiler.capture.getOptions().thresholdMs),
  ).toBe(50);
  await expect(page.locator("[data-automatic-status]")).toContainText("Armed · >50.00 ms");
  await toggle.click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Trigger preset", { exact: true }).selectOption("1.5");
  await expect(page.getByLabel("Threshold ms", { exact: true })).toHaveValue("25");
  await page.getByLabel("Before frames", { exact: true }).fill("2");
  await page.getByLabel("After frames", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Arm automatic capture", exact: true }).click();
  await page.getByRole("button", { name: "30 FPS", exact: true }).click();
  await expect(page.getByLabel("Threshold ms", { exact: true })).toHaveValue("50");
  expect(
    await page.evaluate(() => window.panelFixture.profiler.capture.getOptions().thresholdMs),
  ).toBe(25);
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.evaluate(() => {
    window.panelFixture.advance(4, 16);
    window.panelFixture.advance(1, 35);
    window.panelFixture.advance(2, 20);
    window.panelFixture.refresh();
  });
  await expect(page.locator("[data-automatic-saved]")).toContainText("Capture saved");
  await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Captured slow frame", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-viewer-duration]")).toHaveText("35.00");
  await expect(dialog.locator("[data-trigger-context]")).toContainText(
    "0.03 s before · 0.04 s after",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect trigger", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "CLEAR", exact: true }).click();
  await expect(page.locator("[data-automatic-saved]")).toBeHidden();
});

test("automatic imports select the recorded trigger and explain deliberately missing trigger GPU time", async ({
  page,
}) => {
  const fixture = recordingFixture();
  const frame = fixture.frames[1];
  if (!frame) {
    throw new Error("Missing fixture frame");
  }
  const recording = {
    ...fixture,
    truncated: true,
    gpu: [
      {
        measurement: "intervals",
        frameId: frame?.id,
        rendererFrameId: 2,
        sequence: 2,
        clock: { id: "test", domain: "webgpu-timestamp", unit: "nanoseconds", originNs: "0" },
        passes: [],
        rejectedPasses: [],
        expectedPasses: 1,
        omittedPasses: 1,
        completeness: "incomplete",
        issues: ["sampled-out"],
        metrics: null,
      },
    ],
    capture: {
      kind: "automatic",
      triggerFrameId: frame.id,
      thresholdMs: 10,
      beforeFrames: 1,
      afterFrames: 0,
    },
  };
  await page.goto("/examples/viewer/");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "automatic.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(page.locator("[data-viewer-frame]")).toContainText(`Frame #${frame.id}`);
  await expect(page.locator("[data-trigger-context]")).toContainText("before");
  await expect(page.locator("[data-trigger-context]")).toContainText("Trigger GPU not sampled");
  await page.getByRole("button", { name: "Previous frame", exact: true }).click();
  await page.getByRole("button", { name: "Go to trigger", exact: true }).click();
  await expect(page.locator("[data-viewer-frame]")).toContainText(`Frame #${frame.id}`);
  const measured = {
    frameId: frame.id,
    rendererFrameId: 3,
    measurement: "pass-sum",
    durationMs: 2,
    passes: [{ label: "Scene", durationMs: 2 }],
    omittedPasses: 0,
  };
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "mixed.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...recording, gpu: [...recording.gpu, measured] })),
  });
  await expect(page.locator("[data-trigger-context]")).not.toContainText("Trigger GPU not sampled");
});

test("disarming finishes pending context, manual recording disables the toggle, and removal closes inspection", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Trigger preset", { exact: true })).toBeFocused();
  await page.getByLabel("Trigger preset", { exact: true }).selectOption("2");
  await expect(page.getByLabel("Threshold ms", { exact: true })).toHaveValue(String(2000 / 60));
  await page.getByLabel("Trigger preset", { exact: true }).selectOption("custom");
  await page.getByLabel("Threshold ms", { exact: true }).fill("25");
  await page.getByLabel("After frames", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Arm automatic capture", exact: true }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.evaluate(() => {
    window.panelFixture.advance(1, 35);
    window.panelFixture.refresh();
  });
  const toggle = page.getByRole("button", { name: "Capture slow frames", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-automatic-status]")).toContainText("will disarm after context");
  await page.evaluate(() => {
    window.panelFixture.advance(2, 16);
    window.panelFixture.refresh();
  });
  await expect(page.locator("[data-automatic-status]")).toContainText("Disarmed");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await expect(toggle).toBeDisabled();
  await page.getByRole("button", { name: "STOP REC", exact: true }).click();
  await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => window.panelFixture.panel.dispose());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.panelFixture.profiler.capture.list().length),
  ).toBeGreaterThan(0);
});

for (const width of [390, 1280]) {
  test(`@visual automatic capture notice and inspector at ${width}px`, async ({ page }) => {
    // Frame time is synthetic; real cost-clock noise would rescale every lane through ×20 overhead.
    await page.addInitScript(() => {
      Object.defineProperty(performance, "now", { value: () => 0 });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/fixtures/panel/?mode=full");
    await page.evaluate(() => {
      window.panelFixture.profiler.capture.arm({
        thresholdMs: 25,
        beforeFrames: 2,
        afterFrames: 2,
        cooldownMs: 5000,
      });
      window.panelFixture.advance(4, 16);
      window.panelFixture.advance(1, 35);
      window.panelFixture.advance(2, 20);
      window.panelFixture.refresh();
    });
    await expect(page.locator(".jank")).toHaveScreenshot(`automatic-notice-${width}.png`, {
      mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
      maskColor: "#0a0a0a",
    });
    await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Captured slow frame", exact: true });
    await expect(dialog).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (width < 1100) {
      const end = await dialog.locator(".jank-viewer-captures").boundingBox();
      const inspector = await dialog.locator(".jank-viewer-inspector").boundingBox();
      expect(inspector?.y).toBeGreaterThanOrEqual((end?.y ?? 0) + (end?.height ?? 0));
    }
    await expect(dialog).toHaveScreenshot(`automatic-inspector-${width}.png`, {
      mask: [
        dialog.locator('[data-work-key="overhead"]'),
        dialog.locator('[data-lane-kind="frame"]').filter({ hasText: "profiler" }),
      ],
    });
  });
}
