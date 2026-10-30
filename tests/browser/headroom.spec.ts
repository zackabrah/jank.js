import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("quick headroom uses Jank's budget and restores controls on stop and resize", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Target FPS", { exact: true }).fill("30");
  await page.getByRole("button", { name: "APPLY", exact: true }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.getByRole("button", { name: "Pause motion", exact: true }).click();
  await page.getByText("Sources & files", { exact: true }).click();
  await page.getByRole("combobox", { name: "GPU timing", exact: true }).selectOption("synthetic");
  await page.getByRole("combobox", { name: "Objects", exact: true }).selectOption("64");
  await page.getByRole("combobox", { name: "Extra CPU per frame" }).selectOption("6");
  await page.getByText("Quick headroom test", { exact: true }).click();
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await expect(page.locator("#headroom-context")).toContainText("30 FPS");
  await expect(page.locator("#headroom-context")).toContainText("33.33 ms");
  await expect(page.getByRole("combobox", { name: "Objects", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "GPU timing", exact: true })).toHaveValue(
    "webgl2",
  );
  await expect(page.getByRole("button", { name: "Stop estimate", exact: true })).toBeEnabled();
  await expect(
    page
      .locator('[data-list="counters"] .jank-row')
      .filter({ hasText: "extraMs" })
      .locator("span")
      .last(),
  ).toHaveText("0");
  await expect(
    page
      .locator('[data-list="counters"] .jank-row')
      .filter({ hasText: "paused" })
      .locator("span")
      .last(),
  ).toHaveText("false");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Stop estimate", exact: true }).click();
  await expect(page.locator("#headroom-status")).toContainText("Stopped by user");
  await expect(page.getByRole("button", { name: "Resume motion", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Objects", exact: true })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Objects", exact: true })).toHaveValue("64");
  await expect(page.getByRole("combobox", { name: "GPU timing", exact: true })).toHaveValue(
    "synthetic",
  );
  await expect(page.getByRole("combobox", { name: "Extra CPU per frame" })).toHaveValue("6");
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#headroom-status")).toContainText("Viewport changed");
  await expect(page.getByRole("combobox", { name: "Objects", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("quick estimate finishes with honest measurements and a restored scene", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/examples/basic/");
  await page.getByText("Quick headroom test", { exact: true }).click();
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await expect(page.getByRole("button", { name: "Estimate headroom", exact: true })).toBeEnabled({
    timeout: 70000,
  });
  await expect(page.locator("#headroom-results")).toContainText("Baseline");
  await expect(page.locator("#headroom-results")).toContainText("GPU");
  await expect(page.locator("#headroom-status")).not.toContainText("Running");
  await expect(page.locator("#demo-error")).toBeHidden();
  await expect(page.locator('[data-list="counters"]')).toContainText("36");
});

test("budget changes cancel a run and missing timer support never becomes GPU capacity", async ({
  page,
}) => {
  await page.addInitScript(() => {
    WebGL2RenderingContext.prototype.getExtension = new Proxy(
      WebGL2RenderingContext.prototype.getExtension,
      {
        apply(target, receiver, args) {
          return args[0] === "EXT_disjoint_timer_query_webgl2"
            ? null
            : Reflect.apply(target, receiver, args);
        },
      },
    );
  });
  await page.goto("/examples/basic/");
  await page.getByText("Quick headroom test", { exact: true }).click();
  await page.getByRole("button", { name: "Estimate headroom", exact: true }).click();
  await expect(page.locator("#headroom-baseline")).toContainText("GPU unknown", { timeout: 10000 });
  await expect(page.locator("#headroom-gpu")).toContainText("No level verified");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Target FPS", { exact: true }).fill("30");
  await page.getByRole("button", { name: "APPLY", exact: true }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await expect(page.locator("#headroom-status")).toContainText("Jank budget changed");
  await expect(page.getByRole("button", { name: "Estimate headroom", exact: true })).toBeEnabled();
});

test("the GPU probe adds real rendering work and releases its load on restore", async ({
  page,
}) => {
  await page.goto("/examples/basic/");
  const counters = await page.evaluate(async () => {
    const sceneModulePath = "/examples/basic/scene.ts";
    const { createScene }: typeof import("../../examples/basic/scene.ts") = await import(
      sceneModulePath
    );
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:128px;height:128px";
    document.body.append(canvas);
    const scene = createScene(canvas);
    await new Promise(requestAnimationFrame);
    scene.render();
    const baseline = scene.counters();
    scene.stressGpu(8);
    scene.render();
    const probe = scene.counters();
    scene.setCount(144);
    scene.render();
    const complex = scene.counters();
    scene.clearStress(36);
    scene.render();
    const restored = scene.counters();
    scene.dispose();
    canvas.remove();
    return { baseline, probe, complex, restored };
  });
  expect(counters.probe.draws).toBe(counters.baseline.draws + 1);
  expect(counters.complex.draws).toBeGreaterThan(counters.probe.draws);
  expect(counters.restored).toEqual(counters.baseline);
});
