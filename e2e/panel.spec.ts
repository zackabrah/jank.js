import { expect, test, type Page, type TestInfo } from "@playwright/test";

import AxeBuilder from "@axe-core/playwright";

import { mkdir, readFile } from "node:fs/promises";

import { parseRecording } from "../src/core/recording.ts";

import { boardShot, openFixture } from "./fixture.ts";

test.use({ viewport: { width: 1440, height: 900 } });

function errors(page: Page) {
  const seen: string[] = [];

  page.on("pageerror", (error) => seen.push(error.message));

  return seen;
}

/** The board views, reproduced at 1440 × 900. `pnpm docs:images` copies them into the manual. */
async function shoot(page: Page, info: TestInfo, name: string) {
  if (info.project.name !== "chromium") return;

  await mkdir("artifacts/screenshots", { recursive: true });

  await page.screenshot({ path: boardShot(`${name}.png`) });
}

const slot = (page: Page, key: string) => page.locator(`[data-k="${key}"]`);

test("full panel reads a running game, freezes the display and exports the recording", async ({
  page,
}, info) => {
  const seen = errors(page);

  await openFixture(page, { mode: "full" });

  const panel = page.locator(".jank");

  await expect(panel).toHaveAttribute("data-mode", "full");

  await expect(slot(page, "build-info")).toHaveText(
    /^v\d+\.\d+\.\d+ · [a-f0-9]{8}( · local changes)?$/,
  );

  await expect(slot(page, "fps")).toHaveText(/^\d+$/);

  await page.getByRole("button", { name: "REC", exact: true }).click();

  await expect(panel).toHaveAttribute("data-recording", "true");

  await expect(slot(page, "rec-chip")).toBeVisible();

  await expect(slot(page, "state")).toHaveText(/^[\d,]+ \/ 6,000$/);

  await page.waitForTimeout(400);

  await page.evaluate(() => window.fixture.spike(40));

  await expect(slot(page, "worst")).toHaveAttribute("data-tone", "miss");

  await expect(slot(page, "events")).toContainText("spawn ×184");

  // Let the spike travel into the graph, then mark a later event, as the board shows.
  await page.waitForTimeout(800);

  await page.evaluate(() => window.fixture.event("load chunk 14"));

  await page.waitForTimeout(400);

  await expect(page.locator('[data-k="cpu"] .jank-row')).toHaveCount(5);

  await expect(page.locator('[data-k="cpu"] .jank-row').last()).toContainText(
    "unattributed",
  );

  await expect(slot(page, "gpu-src")).toHaveText("fixture");

  await expect(slot(page, "gpu-frame")).toHaveText(/^from frame [\d,]+$/);

  await expect(slot(page, "counters")).toContainText("draw calls");

  await expect(slot(page, "honest-cpu")).toContainText("cpu timer");

  await expect(slot(page, "oh-collect")).toHaveText(/^\d+\.\d\d$/);

  await shoot(page, info, "panel-full");

  expect(
    (await new AxeBuilder({ page }).include(".jank").analyze()).violations,
  ).toEqual([]);

  await page.getByRole("button", { name: "FREEZE", exact: true }).click();

  await expect(slot(page, "state")).toHaveText("FROZEN");

  await expect(
    page.getByRole("button", { name: "Resume display" }),
  ).toHaveAttribute("aria-pressed", "true");

  const held = await slot(page, "avg").innerText();

  const recorded = await page.evaluate(
    () => window.fixture.monitor.snapshot(false).recordedFrames,
  );

  await page.waitForTimeout(400);

  await expect(slot(page, "avg")).toHaveText(held);

  // Frozen stops the display, not the collection.
  expect(
    await page.evaluate(
      () => window.fixture.monitor.snapshot(false).recordedFrames,
    ),
  ).toBeGreaterThan(recorded);

  await page.getByRole("button", { name: "STOP REC", exact: true }).click();

  await expect(panel).toHaveAttribute("data-recording", "false");

  const downloading = page.waitForEvent("download");

  await page
    .getByRole("tabpanel", { name: "LIVE" })
    .getByRole("button", { name: "EXPORT JSON" })
    .click();

  const download = await downloading;

  expect(download.suggestedFilename()).toBe("jank-recording.json");

  const recording = parseRecording(
    await readFile(await download.path(), "utf8"),
  );

  expect(recording.events.map((event) => event.label)).toContain("spawn ×184");
  expect(recording.frames.some((frame) => frame.scopes.length > 0)).toBe(true);

  await page.getByRole("button", { name: "RESUME", exact: true }).click();

  await page.getByRole("button", { name: "CLEAR", exact: true }).click();

  await expect(slot(page, "events")).toHaveText("no events");

  expect(seen).toEqual([]);
});

test("line and mini sizes report the same frames and the size is remembered", async ({
  page,
}, info) => {
  const seen = errors(page);

  await openFixture(page);

  const panel = page.locator(".jank");

  await expect(panel).toHaveAttribute("data-mode", "line");

  await expect(panel).toHaveCSS("height", "28px");

  await expect(slot(page, "line-fps")).toHaveText(/^\d+$/);

  await page.evaluate(() => window.fixture.monitor.startRecording());

  await page.evaluate(() => window.fixture.spike(40));

  await expect(slot(page, "line-worst")).toHaveAttribute("data-tone", "miss");

  await expect(slot(page, "line-rec")).toBeVisible();

  await shoot(page, info, "panel-line");

  await page.getByRole("button", { name: "Open full panel" }).click();

  await expect(panel).toHaveAttribute("data-mode", "full");

  await expect(page.getByRole("tab", { name: "LIVE" })).toBeFocused();

  await page.getByRole("button", { name: "Shrink to mini view" }).click();

  await expect(panel).toHaveAttribute("data-mode", "mini");

  await expect(panel).toHaveCSS("width", "240px");

  await expect(slot(page, "mini-worst")).toHaveAttribute("data-tone", "miss");

  await expect(slot(page, "mini-top")).toHaveText(/^\S+ \d+\.\d$/);

  await page.waitForTimeout(600);

  await shoot(page, info, "panel-mini");

  expect(
    (await new AxeBuilder({ page }).include(".jank").analyze()).violations,
  ).toEqual([]);

  await page.reload();

  await page.evaluate(() => window.fixture.loaded);

  await expect(panel).toHaveAttribute("data-mode", "mini");

  await page.getByRole("button", { name: "Collapse to one line" }).click();

  await expect(panel).toHaveAttribute("data-mode", "line");

  expect(seen).toEqual([]);
});

test("LOADING lays the stages on one axis beside the cold run and every session", async ({
  page,
}, info) => {
  await openFixture(page, { mode: "full" });

  await page.getByRole("tab", { name: "LOADING" }).click();

  const loading = page.getByRole("tabpanel", { name: "LOADING" });

  await expect(loading).toBeVisible();

  await expect(slot(page, "cache")).toHaveText("94%");

  await expect(page.locator('[data-k="stages"] .jank-stage')).toHaveCount(6);

  await expect(
    page.locator('[data-k="stages"] [data-tone="heavy"]'),
  ).toHaveCount(1);

  await expect(
    page.locator('[data-k="sessions"] .jank-row .jank-k'),
  ).toHaveText(["#1 cold", "#2", "#3", "#4 now"]);

  // The shared axis switches from milliseconds to seconds for slower cold runs.
  await expect(slot(page, "total")).toHaveText(/^\d+\.\d{1,2}$/);

  await shoot(page, info, "panel-loading");

  expect(
    (await new AxeBuilder({ page }).include(".jank").analyze()).violations,
  ).toEqual([]);
});

test("CAPTURE sets the budget, edits the capture window in place and keeps captures", async ({
  page,
}, info) => {
  const seen = errors(page);

  await openFixture(page, { mode: "full" });

  const tab = page.getByRole("tab", { name: "LIVE" });

  await tab.focus();

  await page.keyboard.press("ArrowRight");

  await expect(page.getByRole("tab", { name: "LOADING" })).toBeFocused();

  await page.keyboard.press("End");

  await expect(page.getByRole("tab", { name: "CAPTURE" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "30", exact: true }).click();

  await expect(slot(page, "budget")).toHaveText("33.3");

  await page.getByRole("button", { name: "60", exact: true }).click();

  await expect(slot(page, "budget")).toHaveText("16.7");

  await expect(slot(page, "captures-empty")).toHaveText(
    "nothing captured yet. that is a good sign, or a quiet build.",
  );

  const threshold = page.getByRole("button", { name: "threshold, edit" });

  await threshold.click();

  await page.keyboard.type("99");

  await page.keyboard.press("Escape");

  await expect(threshold).toHaveText("33.3 ms");

  await threshold.click();

  await page.getByLabel("threshold ms").fill("30");

  await page.keyboard.press("Enter");

  await expect(threshold).toHaveText("30.0 ms");

  await expect(threshold).toBeFocused();

  await page.getByRole("button", { name: "after, edit" }).click();

  await page.getByLabel("after frames").fill("60");

  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "Automatic spike capture" }).click();

  await expect(
    page.getByRole("button", { name: "Automatic spike capture" }),
  ).toHaveAttribute("aria-pressed", "true");

  await expect(slot(page, "state")).toHaveText("armed");

  await page.evaluate(() => window.fixture.spike(45));

  await expect(slot(page, "captured-meta")).toHaveText(
    /^1 \/ 10 · \d+\.\d MB$/,
    { timeout: 10000 },
  );

  // Each nearby event leads with its icon, the same one the viewer and recordings show.
  await expect(page.locator('[data-k="captures"] .jank-near')).toHaveText(
    "+ wave 3 · △ spawn ×184",
  );

  await expect(page.locator('[data-k="captures"] .jank-ms')).toHaveAttribute(
    "data-tone",
    "miss",
  );

  await shoot(page, info, "panel-capture");

  expect(
    (await new AxeBuilder({ page }).include(".jank").analyze()).violations,
  ).toEqual([]);
  expect(seen).toEqual([]);
});
