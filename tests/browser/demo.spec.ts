import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/examples/basic/");
  await expect(page.getByRole("heading", { name: "Jank demo" })).toBeVisible();
  await expect(page.locator("#host-frames")).not.toHaveText("0");
});

test("the default GPU source uses the renderer timer and survives profiler restart", async ({
  page,
}) => {
  await page.getByText("Sources & files", { exact: true }).click();
  const source = page.getByRole("combobox", { name: "GPU timing", exact: true });
  await expect(source).toHaveValue("webgl2");
  await expect(page.locator('[data-list="gpu"]')).not.toContainText("SIMULATED");
  await page.getByText("Panel controls", { exact: true }).click();
  await page.getByRole("button", { name: "Stop profiler" }).click();
  await page.getByRole("button", { name: "Start profiler" }).click();
  await expect(source).toHaveValue("webgl2");
  await expect(page.locator('[data-value="gpu-note"]')).not.toHaveText("disabled");
  await expect(page.locator("#demo-error")).toBeHidden();
});

test("the real host loop renders objects, exposes counters and keeps running when motion pauses", async ({
  page,
}) => {
  await expect(page.locator('[data-list="scopes"]')).toContainText("animation");
  await page.getByRole("combobox", { name: "Objects", exact: true }).selectOption("64");
  await expect(page.locator('[data-list="counters"]')).toContainText("64");
  const objectValue = page
    .locator('[data-list="counters"] .jank-row')
    .filter({ hasText: "objects" })
    .locator("span")
    .last();
  await expect(objectValue).toHaveText("64");
  expect(
    await objectValue.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(20);
  await page.getByRole("button", { name: "Pause motion" }).click();
  const before = Number(await page.locator("#host-frames").textContent());
  await expect
    .poll(async () => Number(await page.locator("#host-frames").textContent()))
    .toBeGreaterThan(before + 5);
  await expect(page.getByRole("button", { name: "Resume motion" })).toBeVisible();
  expect(
    await page
      .locator("#scene")
      .evaluate((canvas) => canvas instanceof HTMLCanvasElement && canvas.width > 0),
  ).toBe(true);
  await expect(page.locator("#demo-error")).toBeHidden();
  await page.getByText("Sources & files", { exact: true }).click();
  await page.getByLabel("Simulate counter error").check();
  await expect(page.locator('[data-list="counters"]')).toContainText(
    "Intentional demo counter failure",
  );
  await page.getByLabel("Simulate counter error").uncheck();
  await expect(page.locator('[data-list="counters"]')).toContainText("64");
});

test("one-click automatic capture retains the deliberately slow frame and exports a valid file", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Capture next hitch" }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const exportButton = page.getByRole("button", { name: "Export capture 1" });
  await expect(exportButton).toBeVisible({ timeout: 10_000 });
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) {
    throw new Error("Missing capture download");
  }
  const result = parseRecording(await readFile(path, "utf8"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.recording.capture.kind).toBe("automatic");
    expect(result.recording.frames.some((frame) => frame.endedAtMs - frame.startedAtMs >= 50)).toBe(
      true,
    );
    expect(result.recording.events.some((event) => event.label.includes("hitch"))).toBe(true);
  }
});

test("panel removal preserves manual capture and profiler disposal preserves the scene", async ({
  page,
}) => {
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.getByText("Panel controls", { exact: true }).click();
  await page.getByRole("button", { name: "Detach panel" }).click();
  await expect(page.locator(".jank")).toHaveCount(0);
  const before = Number(await page.locator("#host-frames").textContent());
  await expect
    .poll(async () => Number(await page.locator("#host-frames").textContent()))
    .toBeGreaterThan(before + 10);
  await page.getByRole("button", { name: "Attach panel" }).click();
  await page.getByRole("button", { name: "STOP REC", exact: true }).click();
  await expect(page.locator("#archive-count")).toHaveText("1");
  await page.getByRole("button", { name: "Stop profiler" }).click();
  await expect(page.locator(".jank")).toHaveCount(0);
  await expect
    .poll(async () => Number(await page.locator("#host-frames").textContent()))
    .toBeGreaterThan(before + 20);
  await page.getByRole("button", { name: "Start profiler" }).click();
  await expect(page.locator(".jank")).toBeVisible();
  await expect(page.locator("#archive-count")).toHaveText("0");
});

test("borrowed GPU, loading and trace sources are explicit and recording validation preserves the last valid result", async ({
  page,
}) => {
  await page.getByText("Sources & files", { exact: true }).click();
  await page.getByRole("combobox", { name: "GPU timing", exact: true }).selectOption("synthetic");
  await expect(page.locator('[data-list="gpu"]')).toContainText("SIMULATED");
  await page.getByRole("button", { name: "Run loading example" }).click();
  await page.getByRole("tab", { name: "LOADING", exact: true }).click();
  await expect(page.locator('[data-value="loading-state"]')).toContainText("ready");
  await expect(page.locator('[data-list="loading"]')).toContainText("host wait");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByRole("button", { name: "TRACE", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          performance.getEntries().filter((entry) => entry.name.startsWith("jank-demo:")).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "TRACE", exact: true }).click();
  expect(
    await page.evaluate(
      () => performance.getEntries().filter((entry) => entry.name.startsWith("jank-demo:")).length,
    ),
  ).toBeLessThanOrEqual(200);
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT JSON", exact: true }).click();
  const path = await (await downloaded).path();
  if (!path) {
    throw new Error("Missing recording download");
  }
  await page.getByLabel("Validate a recording").setInputFiles(path);
  await expect(page.locator("#recording-summary")).toContainText("Valid schema 3");
  const summary = await page.locator("#recording-summary").textContent();
  await page.getByLabel("Validate a recording").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.locator("#import-error")).toBeVisible();
  await expect(page.locator("#recording-summary")).toHaveText(summary ?? "");
});

test("controls stay accessible on desktop and narrow screens", async ({ page }) => {
  expect(await page.locator("#scene").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
  await page.getByText("Sources & files", { exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator("#scene").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
