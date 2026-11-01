import AxeBuilder from "@axe-core/playwright";
import { gpuIntervalFixture } from "../fixtures/gpu-sample.ts";
import { expect, test } from "../fixtures/visual-test.ts";

test("GPU rows retain configured order, DOM identity and space when work is absent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 1100 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(async (sample) => {
    const path = "/packages/jank/src/index.ts";
    const { createPanel }: typeof import("../../packages/jank/src/index.ts") = await import(path);
    window.panelFixture.panel.dispose();
    window.panelFixture.panel = createPanel({
      container: document.body,
      profiler: window.panelFixture.profiler,
      mode: "full",
      gpuPassOrder: ["scene", "fft"],
    });
    window.panelFixture.advance(3);
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      currentFrameSequence: 2,
      pendingFrames: 1,
      droppedSamples: 0,
      sample,
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  const passes = page.locator(".jank-gpu-pass");
  await expect(passes).toHaveCount(3);
  expect(
    await passes.evaluateAll((rows) =>
      rows.map((row, index) => {
        row.setAttribute("data-test-identity", String(index));
        return row.getAttribute("data-pass-id");
      }),
    ),
  ).toEqual(["scene", "fft", "fft"]);
  const before = await passes.evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect().height),
  );
  await page.evaluate((sample) => {
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      currentFrameSequence: 2,
      pendingFrames: 1,
      droppedSamples: 0,
      sample: {
        ...sample,
        passes: sample.passes
          .filter((pass) => pass.id === "scene")
          .map((pass) => ({ ...pass, invocation: 1 })),
        sequence: 2,
        expectedPasses: 1,
        metrics: { renderSumMs: 4, computeSumMs: 0, combinedSumMs: 4, busyMs: 4, elapsedSpanMs: 4 },
      },
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  await expect(passes).toHaveCount(3);
  expect(
    await passes.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-test-identity"))),
  ).toEqual(["0", "1", "2"]);
  expect(
    await passes.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)),
  ).toEqual(before);
  const absent = page.locator('.jank-gpu-pass[data-pass-id="fft"]').first();
  await expect(absent).toHaveAttribute("data-observation", "not-observed");
  await expect(absent).toContainText("Not observed in this sample");
  await expect(absent).not.toContainText("4.00");
  expect(await absent.evaluate((row) => getComputedStyle(row).color)).not.toBe(
    await passes.first().evaluate((row) => getComputedStyle(row).color),
  );
  await page.getByRole("button", { name: "FREEZE", exact: true }).click();
  await page.evaluate((sample) => {
    window.panelFixture.profiler.observeGpu({
      status: "ready",
      currentRendererFrameId: 8,
      droppedSamples: 0,
      sample: { ...sample, sequence: 3 },
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  await expect(absent).toHaveAttribute("data-observation", "not-observed");
  await page.getByRole("button", { name: "RESUME", exact: true }).click();
  await expect(absent).toHaveAttribute("data-observation", "observed");
  await expect(absent).toContainText("4.00");
  await page.evaluate(() => {
    window.panelFixture.profiler.observeGpu({ status: "pending" });
    window.panelFixture.refresh();
  });
  await expect(passes).toHaveCount(3);
  await expect(passes.first()).toHaveAttribute("data-observation", "unavailable");
  await expect(page.locator('[data-list="gpu"]')).not.toContainText("4.00");
  expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "CLEAR", exact: true }).click();
  await expect(passes).toHaveCount(0);
});

test("@visual missing GPU passes remain pinned and dimmed at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 1100 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate((sample) => {
    window.panelFixture.advance(3);
    const state = {
      status: "ready" as const,
      currentRendererFrameId: 8,
      currentFrameSequence: 2,
      pendingFrames: 1,
      droppedSamples: 0,
      sample,
    };
    window.panelFixture.profiler.observeGpu(state);
    window.panelFixture.refresh();
    window.panelFixture.profiler.observeGpu({
      ...state,
      sample: {
        ...sample,
        sequence: 2,
        passes: sample.passes
          .filter((pass) => pass.id === "scene")
          .map((pass) => ({ ...pass, invocation: 1 })),
        expectedPasses: 1,
        metrics: { renderSumMs: 4, computeSumMs: 0, combinedSumMs: 4, busyMs: 4, elapsedSpanMs: 4 },
      },
    });
    window.panelFixture.refresh();
  }, gpuIntervalFixture());
  await page.getByRole("region", { name: "Performance details" }).evaluate((region) => {
    region.scrollTop = region.scrollHeight;
  });
  await expect(page.locator(".jank")).toHaveScreenshot("gpu-missing-passes.png", {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  });
});
