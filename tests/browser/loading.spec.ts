import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("loading promises retain their run across replacement in a browser host", async ({ page }) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  const result = await page.evaluate(async () => {
    const path = "/packages/jank/src/index.ts";
    const { createLoadingProfiler }: typeof import("../../packages/jank/src/index.ts") =
      await import(path);
    const loading = createLoadingProfiler();
    const first = loading.beginRun({ label: "First", kind: "fresh-context" });
    let resolve: (value: number) => void = () => {};
    const pending = first.measure(
      "fetch",
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const second = loading.beginRun({ label: "Second", kind: "repeat-session" });
    resolve(42);
    const value = await pending;
    second.finish("ready");
    const result = { value, history: loading.history(), baseline: loading.baseline() };
    loading.dispose();
    return result;
  });
  expect(result.value).toBe(42);
  expect(result.history).toMatchObject([
    { status: "cancelled", pendingOperations: 1, stages: [{ name: "fetch" }] },
    { status: "ready", pendingOperations: 0, stages: [] },
  ]);
  expect(result.baseline).toBeNull();
});

test("loading panel shows cold ghosts, honest overlap/cache totals, frozen sessions and borrowed ownership", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/loading/");
  await page.getByRole("tab", { name: "LOADING", exact: true }).click();
  await expect(page.locator('[data-value="loading-state"]')).toHaveText("No loading run recorded.");
  await page.evaluate(() => window.loadingFixture.cold());
  await expect(page.locator('[data-value="loading-total"]')).toHaveText("500.0 ms");
  await expect(page.locator('[data-value="loading-cold"]')).toHaveText("500.0 ms");
  await expect(page.locator('[data-list="loading"]')).toContainText("700.0 ms combined");
  await expect(page.locator('[data-list="loading-cache"]')).toContainText("2048 bytes");
  await page.evaluate(() => {
    const { loading, at } = window.loadingFixture;
    const run = loading.beginRun({ label: "Scene repeat", kind: "repeat-session" });
    const op = run.startStage("fetch");
    op.recordCache("hit");
    at(600);
    op.finish();
    run.finish("ready");
    at(900);
  });
  await expect(page.locator('[data-value="loading-total"]')).toHaveText("100.0 ms");
  await expect(page.locator('[data-value="loading-cache-rate"]')).toHaveText("100%");
  await expect(page.locator("[data-loading-cold-bar]")).toHaveAttribute("style", /100%/);
  await expect(page.locator("[data-loading-current-bar]")).toHaveAttribute("style", /20%/);
  await expect(page.locator('[data-list="loading-sessions"]')).toContainText("Scene cold");
  await page.getByRole("button", { name: "Freeze display", exact: true }).click();
  await page.evaluate(() => {
    const { loading, at } = window.loadingFixture;
    loading.beginRun({ label: "Pending scene", kind: "editor" }).startStage("decode");
    at(1400);
  });
  await expect(page.locator('[data-value="loading-state"]')).toContainText("Scene repeat");
  await page.getByRole("button", { name: "Resume display", exact: true }).click();
  await expect(page.locator('[data-value="loading-state"]')).toContainText("1 pending");
  await page.evaluate(() => window.loadingFixture.panel.dispose());
  expect(await page.evaluate(() => window.loadingFixture.loading.snapshot()?.status)).toBe(
    "loading",
  );
});

for (const width of [390, 1280]) {
  test(`@visual loading stages, cold baseline and sessions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/fixtures/loading/");
    await page.evaluate(() => window.loadingFixture.cold());
    await page.getByRole("tab", { name: "LOADING", exact: true }).click();
    expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
    await expect(page.locator(".jank")).toHaveScreenshot(`loading-${width}.png`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
