import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";
import { expect, test } from "../fixtures/visual-test.ts";

async function mount(page: Page, mode: "deferred" | "timeout" | "error", timeoutMs = 2000) {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(
    async ({ mode, timeoutMs }) => {
      const path = "/tests/fixtures/panel/export.ts";
      const fixture: typeof import("../fixtures/panel/export.ts") = await import(path);
      fixture.mountExportFixture(mode, timeoutMs);
    },
    { mode, timeoutMs },
  );
}

test("Stop & Export finalizes this recording, shows completeness, and leaves the host running", async ({
  page,
}) => {
  await mount(page, "deferred");
  await page.evaluate(() => {
    window.panelFixture.profiler.capture.start();
    window.panelFixture.advance(2);
    window.panelFixture.profiler.capture.stop();
    window.panelFixture.refresh();
  });
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => window.panelFixture.advance(3));
  await page.getByRole("button", { name: "STOP & EXPORT", exact: true }).click();
  await expect(page.locator("[data-export-status]")).toContainText("Finalizing GPU");
  await expect(page.locator('[data-action="export"]')).toBeDisabled();
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState().status)).toBe(
    "idle",
  );
  const requested = await page.evaluate(() => window.exportFixture.requested());
  expect(requested).toEqual(
    await page.evaluate(() =>
      window.panelFixture.profiler.capture.read(2)?.frames.map((frame) => frame.id),
    ),
  );
  await page.evaluate(() => window.panelFixture.advance(5));
  const downloading = page.waitForEvent("download");
  await page.evaluate(() => window.exportFixture.release());
  const download = await downloading;
  const path = await download.path();
  if (!path) {
    throw new Error("No export downloaded");
  }
  const parsed = parseRecording(await readFile(path, "utf8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error(parsed.problem.message);
  }
  expect(parsed.recording.frames.map((frame) => frame.id)).toEqual(requested);
  expect(parsed.recording.gpu).toHaveLength(requested.length);
  expect(parsed.recording.truncated).toBe(false);
  await expect(page.locator("[data-export-status]")).toContainText("100.0%");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.locator('[data-export-notice="2"]')).toContainText("Download requested");
  await expect(page.locator('[data-export-notice="2"]')).toContainText("100.0%");
  expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
});

test("timeout and failure export available evidence and explain incomplete GPU timing", async ({
  page,
}) => {
  for (const mode of ["timeout", "error"] as const) {
    await mount(page, mode, 20);
    await page.getByRole("button", { name: "REC", exact: true }).click();
    await page.evaluate(() => window.panelFixture.advance(2));
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "STOP & EXPORT", exact: true }).click();
    await downloading;
    await expect(page.locator("[data-export-status]")).toContainText(
      mode === "timeout" ? "timed out" : "Device readback failed",
    );
    await expect(page.locator("[data-export-status]")).toContainText("2 without interval evidence");
    await expect(page.getByRole("button", { name: "EXPORT JSON", exact: true })).toBeEnabled();
  }
});

test("clear and disposal prevent a pending export from downloading later", async ({ page }) => {
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  for (const action of ["clear", "dispose"] as const) {
    await mount(page, "deferred");
    await page.getByRole("button", { name: "REC", exact: true }).click();
    await page.evaluate(() => window.panelFixture.advance(2));
    await page.getByRole("button", { name: "STOP & EXPORT", exact: true }).click();
    if (action === "clear") {
      await page.getByRole("button", { name: "CLEAR", exact: true }).click();
    } else {
      await page.evaluate(() => window.panelFixture.panel.dispose());
    }
    await page.evaluate(async () => {
      window.exportFixture.release();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(downloads).toEqual([]);
  }
});

test("sources without a resolver export immediately with an explicit limitation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => window.panelFixture.advance(2));
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "STOP & EXPORT", exact: true }).click();
  await downloading;
  await expect(page.locator("[data-export-status]")).toContainText("No GPU resolver");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
});

test("@visual finalized export coverage stays readable beside a saved capture on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mount(page, "deferred");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => window.panelFixture.advance(12));
  await page.getByRole("button", { name: "STOP & EXPORT", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.evaluate(() => window.exportFixture.release());
  await downloading;
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.locator("[data-export-notice]").scrollIntoViewIfNeeded();
  await expect(page.locator(".jank")).toHaveScreenshot("panel-finalized-export-narrow.png", {
    mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
    maskColor: "#0a0a0a",
  });
});
