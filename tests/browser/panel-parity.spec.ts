import { expect, test } from "@playwright/test";

test("graph parity: worst marker, fixed annotations, event glyphs and newest-frame emphasis", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.advance(70);
    window.panelFixture.profiler.addEvent("◆ Scene loaded");
    window.panelFixture.advance(1, 40);
    window.panelFixture.advance(4);
  });
  const chart = page.locator('[data-live-chart="full"]');
  await expect(chart.locator('[data-chart-label="worst"]')).toHaveText("worst 40.0");
  await expect(chart.locator('[data-chart-label="budget"]')).toHaveText("16.7");
  await expect(chart.locator('[data-chart-label="event"]')).toContainText("◆ Scene loaded");
  await expect(chart.locator('[data-chart-label="event"]')).toContainText("s ago");
  await expect(chart.locator("canvas")).toHaveAttribute("aria-label", /Scene loaded/);
  const colors = await chart.locator("canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Expected canvas");
    }
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Missing canvas context");
    }
    const ratio = canvas.width / parseFloat(canvas.style.width);
    const pixel = (offset: number) => [
      ...context.getImageData(
        Math.floor(canvas.width - offset * ratio),
        Math.floor((120 - 18) * ratio),
        1,
        1,
      ).data,
    ];
    return { newest: pixel(1), older: pixel(4), worst: pixel(13) };
  });
  expect(colors.newest[0]).toBeGreaterThan(colors.older[0] ?? 255);
  expect(colors.worst[0]).toBeGreaterThan(colors.worst[1] ?? 255);

  expect(await chart.locator("canvas").evaluate((canvas) => canvas.getAnimations().length)).toBe(0);
});

test("graph glide stops for freeze, hidden tabs, reduced motion and disposal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/fixtures/panel/?mode=full");
  const running = await page.evaluate(() => {
    window.panelFixture.advance(70);
    window.panelFixture.advance(10);
    return document.querySelector('[data-chart="full"]')?.getAnimations().length;
  });
  expect(running).toBe(1);
  await page.getByRole("button", { name: "FREEZE", exact: true }).click();
  expect(
    await page.locator('[data-chart="full"]').evaluate((canvas) => canvas.getAnimations().length),
  ).toBe(0);
  await page.getByRole("button", { name: "RESUME", exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  expect(
    await page.locator('[data-chart="full"]').evaluate((canvas) => canvas.getAnimations().length),
  ).toBe(0);
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.evaluate(() => {
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
      "change",
      () => {
        document.body.dataset.motionChanged = "true";
      },
      { once: true },
    );
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("body")).toHaveAttribute("data-motion-changed", "true");
  expect(
    await page.evaluate(() => {
      window.panelFixture.advance(10);
      return document.querySelector('[data-chart="full"]')?.getAnimations().length;
    }),
  ).toBe(0);
  await page.evaluate(() => window.panelFixture.panel.dispose());
  await expect(page.locator(".jank")).toHaveCount(0);
});

test("CPU and GPU meters show budget fractions without turning absent samples into zero", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.advance(180);
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 1,
      droppedSamples: 0,
      sample: {
        measurement: "pass-sum",
        frameId: 1,
        rendererFrameId: 1,
        durationMs: 4,
        omittedPasses: 0,
        passes: [
          { label: "scene", durationMs: 4 },
          { label: "unknown", durationMs: null },
        ],
      },
    });
    window.panelFixture.refresh();
  });
  const cpu = page.locator('[data-list="scopes"] .jank-row').filter({ hasText: "physics" });
  await expect(cpu).toHaveAttribute("data-heavy", "true");
  expect(
    await cpu
      .locator(".jank-meter-fill")
      .evaluate((fill) => parseFloat((fill as HTMLElement).style.width)),
  ).toBeCloseTo(12);
  const gpu = page.locator(".jank-gpu-pass").filter({ hasText: "scene" });
  expect(
    await gpu
      .locator(".jank-meter-fill")
      .evaluate((fill) => parseFloat((fill as HTMLElement).style.width)),
  ).toBeCloseTo(24);
  await expect(
    page.locator(".jank-gpu-pass").filter({ hasText: "unknown" }).locator(".jank-meter-fill"),
  ).toBeHidden();
  const count = await page
    .locator('[data-live-chart="full"]')
    .evaluate((chart) => Math.floor(chart.clientWidth / 3));
  await expect(page.locator('[data-value="coverage"]')).toContainText(`${count} complete frames`);
  await page.evaluate(() => {
    window.panelFixture.profiler.observeGpu({ status: "pending" });
    window.panelFixture.refresh();
  });
  await expect(gpu.locator(".jank-meter-fill")).toBeHidden();
  await expect(gpu).toContainText("–");
});

test("FPS gauge shows low/high/current and shortcuts preserve budget, freeze and accessible summary", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await expect(page.locator("[data-fps-range]")).toBeHidden();
  await page.evaluate(() => {
    window.panelFixture.advance(80, 10);
    window.panelFixture.advance(80, 20);
  });
  await expect(page.locator("[data-fps-range]")).toBeVisible();
  await expect(page.locator("[data-fps-range]")).toHaveAttribute("aria-label", /current.*range/i);
  const position = await page
    .locator("[data-fps-mark]")
    .evaluate((mark) => parseFloat((mark as HTMLElement).style.top));
  expect(position).toBeGreaterThanOrEqual(0);
  expect(position).toBeLessThanOrEqual(100);
  await page.getByRole("button", { name: "Freeze display", exact: true }).click();
  await expect(page.getByRole("button", { name: "RESUME", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume display", exact: true }).click();
  await page.getByRole("button", { name: "Read summary", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-value="summary"]')).toContainText("frames");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByRole("button", { name: "30 FPS", exact: true }).click();
  await expect(page.getByLabel("Target FPS", { exact: true })).toHaveValue("30");
  expect(await page.evaluate(() => window.panelFixture.profiler.snapshot().targetFps)).toBe(30);
  await page.getByLabel("Target FPS", { exact: true }).fill("75");
  await page.getByRole("button", { name: "APPLY", exact: true }).click();
  await expect(page.getByRole("button", { name: "Custom FPS", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("counters keep readable labels, sources, exact tooltips and an overflow notice", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.profiler.createChannel({
      id: "extras",
      label: "renderer",
      readCounters: () => ({
        drawCalls: 1200,
        triangleCount: 1920000,
        ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`extra${i}`, i])),
      }),
    });
    window.panelFixture.advance(70);
  });
  await expect(page.locator('[data-value="counter-sources"]')).toContainText("renderer");
  await expect(page.locator('[data-list="counters"]')).toContainText("draw calls");
  await expect(page.locator('[data-list="counters"]')).toContainText("1.92M");
  await expect(page.locator('[data-value="counter-note"]')).toContainText("more in the export");
});

test("@visual reference parity includes event annotations, meters and FPS gauge", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 960, height: 1100 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.advance(150);
    window.panelFixture.profiler.addEvent("◆ Scene loaded");
    window.panelFixture.advance(1, 40);
    window.panelFixture.advance(8);
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 2,
      droppedSamples: 0,
      sample: {
        measurement: "pass-sum",
        frameId: 1,
        rendererFrameId: 1,
        durationMs: 4,
        omittedPasses: 0,
        passes: [
          { label: "scene", durationMs: 4 },
          { label: "missing timestamp", durationMs: null },
        ],
      },
    });
    window.panelFixture.refresh();
  });
  await expect(page.locator(".jank")).toHaveScreenshot("panel-reference-parity.png", {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  });
});

test("MINI labels identify the top scope and only warn when the worst frame exceeds budget", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=mini");
  await page.evaluate(() => {
    window.panelFixture.profiler.setTargetFps(30);
    window.panelFixture.advance(70);
  });
  const worst = page.locator('[data-value="mini-worst"]');
  await expect(worst).not.toContainText("▲");
  await expect(worst).toHaveAttribute("data-warning", "false");
  await expect(page.locator('[data-value="mini-channel"]')).toContainText("top physics");
  await page.evaluate(() => {
    window.panelFixture.advance(1, 40);
    window.panelFixture.refresh();
  });
  await expect(worst).toHaveAttribute("data-warning", "true");
});
