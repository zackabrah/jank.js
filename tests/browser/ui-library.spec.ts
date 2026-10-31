import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/recordings/codec.ts";

const artifact = resolve("artifacts/jank-ui-library.html");
test.beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-ui-library.mjs"], { stdio: "pipe" });
});

test("the single HTML file works offline with the real controls, effects and profiler", async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) {
      requests.push(request.url());
    }
  });
  // WebKit offline emulation also blocks file navigation; block network routes there instead.
  await page.route(/^https?:/, (route) => route.abort());
  if (browserName !== "webkit") {
    await page.context().setOffline(true);
  }
  await page.goto(pathToFileURL(artifact).href);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("heading", { name: "UI library", exact: true })).toBeVisible();
  await expect(page.locator("[data-color-token]")).toHaveCount(10);
  await page.getByRole("button", { name: "Toggle preview guides", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Toggle preview guides", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Fields", exact: true }).click();
  await expect(page.getByLabel("Project name", { exact: true })).toBeVisible();
  await page.getByLabel("Project name", { exact: true }).fill("Library demo");
  await page.getByRole("button", { name: "Validate fields", exact: true }).click();
  await expect(page.locator("#field-result")).toContainText("Library demo");
  await expect(page.locator("#full-preview .jank")).toHaveAttribute("data-mode", "full");
  await expect(page.locator("#mini-preview .jank")).toHaveAttribute("data-mode", "mini");
  await expect(page.locator("#line-preview .jank")).toHaveAttribute("data-mode", "line");
  await page.getByRole("combobox", { name: "GPU example", exact: true }).selectOption("missing");
  await expect(
    page.locator('#full-preview .jank-gpu-pass[data-observation="not-observed"]'),
  ).toHaveCount(1);
  const chart = page.locator("#full-preview canvas[data-chart=full]");
  await page.locator('#full-preview [data-live-chart="full"]').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      chart.evaluate((canvas) =>
        canvas.getAnimations().some((animation) => animation.playState === "running"),
      ),
    )
    .toBe(true);
  await page.locator("#full-preview").getByRole("button", { name: "FREEZE", exact: true }).click();
  expect(await chart.evaluate((canvas) => canvas.getAnimations().length)).toBe(0);
  await expect(
    page.locator("#full-preview").getByRole("button", { name: "RESUME", exact: true }),
  ).toBeVisible();
  await page.locator("#full-preview").getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.locator("#full-preview [data-captures] .jank-capture")).toHaveCount(1);
  await expect(page.locator("#full-preview [data-comparison]")).toBeVisible();
  expect(requests).toEqual([]);
  const html = readFileSync(artifact, "utf8");
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+rel=["']stylesheet|@import\s/);
});

test("offline library respects reduced motion and remains accessible on a narrow screen", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(artifact).href);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByRole("button", { name: "Resume sample stream", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("tab", { name: "Fields", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Add sample spike", exact: true }).click();
  await expect(
    page.locator('#full-preview [data-view="full"] [data-chart-label="worst"]'),
  ).toContainText("48.0");
  expect(
    await page
      .locator("#full-preview canvas[data-chart=full]")
      .evaluate((canvas) => canvas.getAnimations().length),
  ).toBe(0);
});

test("sample states preserve unknown timings, keyboard navigation and portable recordings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(pathToFileURL(artifact).href);
  await page.getByRole("tab", { name: "Buttons", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Disclosure", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Buttons", exact: true })).toBeFocused();
  const full = page.locator("#full-preview");
  const gpu = page.getByRole("combobox", { name: "GPU example", exact: true });
  const originalOrder = await full
    .locator(".jank-gpu-pass")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pass-id")));
  await gpu.selectOption("rejected");
  await expect(full.locator('[data-pass-id="ocean"]')).toHaveAttribute(
    "data-observation",
    "rejected",
  );
  await expect(full.locator('[data-pass-id="ocean"]')).toContainText("zero-timestamp");
  await expect(full.locator('[data-list="gpu"] > div').first()).toContainText("–");
  for (const state of ["pending", "unsupported", "error", "missing", "valid"]) {
    await gpu.selectOption(state);
    expect(
      await full
        .locator(".jank-gpu-pass")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pass-id"))),
    ).toEqual(originalOrder);
  }
  await full.getByRole("tab", { name: "LOADING", exact: true }).click();
  await expect(full.locator('[data-tabpanel="loading"]')).toContainText("Simulated scene loading");
  await full.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await full.getByRole("button", { name: "Export capture 1", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  expect(path).not.toBeNull();
  if (!path) {
    throw new Error("The standalone capture was not downloaded");
  }
  const result = parseRecording(readFileSync(path, "utf8"));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.problem.message);
  }
  expect(result.recording.metadata.application?.name).toContain("SIMULATED DATA");
  expect(result.recording.frames.length).toBeGreaterThan(100);
  expect(result.recording.gpu.length).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
