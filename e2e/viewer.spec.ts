import { test, expect } from "@playwright/test";

import AxeBuilder from "@axe-core/playwright";

import { mkdir, readFile } from "node:fs/promises";

import { pathToFileURL } from "node:url";

import { resolve } from "node:path";

import { createDiagnostics } from "../src/core/diagnostics.ts";

import { parseRecording } from "../src/core/recording.ts";

import { boardShot, openFixture } from "./fixture.ts";

test.use({ viewport: { width: 1440, height: 900 } });

function fixture() {
  let now = 0;

  const monitor = createDiagnostics({
    now: () => now,
    application: { name: "Viewer fixture" },
  });

  monitor.startRecording();

  monitor.beginFrame(0);

  const parent = monitor.register("parent", "Parent"),
    child = monitor.register("child", "<img src=x onerror=alert(1)>");

  now = 2;

  const a = parent.begin();

  now = 4;

  const b = child.begin();

  now = 8;

  child.end(b);

  now = 10;

  parent.end(a);

  monitor.event("Test event");

  now = 20;

  monitor.beginFrame(20);

  now = 40;

  monitor.beginFrame(40);

  return Buffer.from(JSON.stringify(monitor.export()));
}

test("single HTML viewer loads offline, inspects scopes, navigates and rejects bad imports safely", async ({
  page,
}, info) => {
  const requests: string[] = [];

  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });

  await page.goto(pathToFileURL(resolve("OPEN RECORDING VIEWER.html")).href);

  await expect(page.locator('[data-k="empty"]')).toContainText(
    "drop a recording here",
  );

  await page.getByLabel("Recording file").setInputFiles({
    name: "capture.json",
    mimeType: "application/json",
    buffer: fixture(),
  });

  await expect(page.locator('[data-k="totals"]')).toContainText("2 frames");

  await expect(page.locator('[data-k="file"]')).toHaveText("capture.json");

  const inspector = page.getByRole("complementary", {
    name: "Frame inspector",
  });

  // 20 ms frame, 8 ms covered by the parent scope: 12 ms unattributed.
  await expect(
    inspector.locator(".jank-viewer-row-k", { hasText: "unattributed" }),
  ).toContainText("12.0");

  await expect(inspector).toContainText("<img src=x onerror=alert(1)>");

  await expect(page.locator("img")).toHaveCount(0);

  await expect(page.locator('[data-k="capture-empty"]')).toHaveText(
    "no frame crossed the threshold in this recording.",
  );

  const playhead = page.getByRole("slider", { name: "Playhead" });

  await expect(playhead).toHaveAttribute("aria-valuenow", "1");

  await playhead.focus();

  await page.keyboard.press("ArrowRight");

  await expect(playhead).toHaveAttribute("aria-valuenow", "2");

  await expect(page.locator('[data-k="s-frame"]')).toHaveText("FRAME 2");

  await page.keyboard.press("Home");

  await expect(playhead).toHaveAttribute("aria-valuenow", "1");

  await expect(page.getByRole("alert")).toBeEmpty();

  await page.getByLabel("Recording file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":999}'),
  });

  await expect(page.getByRole("alert")).toContainText("Invalid recording");

  await expect(page.locator('[data-k="totals"]')).toContainText("2 frames");

  expect(requests).toEqual([]);

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (info.project.name === "chromium")
    await page.screenshot({ path: "artifacts/viewer.png", fullPage: true });
});

test("hosted viewer is part of the static build", async ({ page }) => {
  await page.goto("/viewer/");

  await expect(page.locator('[data-k="build-info"]')).toHaveText(
    /^v\d+\.\d+\.\d+ · [a-f0-9]{8}( · local changes)?$/,
  );

  await page.getByLabel("Recording file").setInputFiles({
    name: "capture.json",
    mimeType: "application/json",
    buffer: fixture(),
  });

  await expect(page.locator(".jank-viewer-legend-text")).toContainText(
    "unattributed frame interval",
  );

  await expect(page.locator('[data-k="env"]')).toContainText("Viewer fixture");
});

test("the panel hands its recording to the viewer, which inspects captures frame by frame", async ({
  page,
  context,
}, info) => {
  const seen: string[] = [];

  context.on("page", (opened) =>
    opened.on("pageerror", (error) => seen.push(error.message)),
  );

  await openFixture(page, { mode: "full" });

  // Recording starts through the monitor: a synthetic click can stall a headless frame,
  // and that stall would rank above the spikes this test makes.
  await page.evaluate(() => window.fixture.monitor.startRecording());

  // Three slow frames between ordinary ones, with events around them, in order.
  /* oxlint-disable no-await-in-loop */
  for (const [wait, step] of [
    [700, "wave 3"],
    [500, "spike 45"],
    [900, "load chunk 9"],
    [300, "spike 70"],
    [900, "checkpoint"],
    [600, "spike 55"],
    [1200, ""],
  ] as const) {
    await page.waitForTimeout(wait);

    if (step.startsWith("spike")) {
      // Captures group spikes within ten recorded frames, not a wall-clock gap.
      // Wait for the preceding spike to be sampled and leave a separate window
      // even when a busy browser delivers fewer frames during the sleeps above.
      await page.waitForFunction(() => {
        const previous = window.fixture.spikeFrames.at(-1);

        const latest = window.fixture.monitor.export().frames.at(-1)?.id;

        return (
          previous === undefined ||
          (latest !== undefined && latest - previous > 20)
        );
      });
    }

    const spikesBefore = await page.evaluate(
      () => window.fixture.spikeFrames.length,
    );

    await page.evaluate((name) => {
      if (name.startsWith("spike")) window.fixture.spike(Number(name.slice(6)));
      else if (name) window.fixture.event(name);
    }, step);

    if (step.startsWith("spike")) {
      await page.waitForFunction(
        (before) => window.fixture.spikeFrames.length > before,
        spikesBefore,
      );
    }
  }

  /* oxlint-enable no-await-in-loop */
  await page.evaluate(() => window.fixture.monitor.stopRecording());

  await page.getByRole("tab", { name: "CAPTURE" }).click();

  const opening = context.waitForEvent("page");

  await page.getByRole("button", { name: "OPEN IN VIEWER" }).click();

  const viewer = await opening;

  await expect(viewer.locator('[data-k="file"]')).toHaveText(
    "jank-recording.json",
  );

  await expect(viewer.locator('[data-k="s-format"]')).toHaveText(
    "format 2 · validated on open",
  );

  const rows = viewer.locator('[data-k="capture-rows"] [role="row"]');

  const total = await rows.count();

  expect(total).toBeGreaterThanOrEqual(3);

  // The viewer opens on the longest capture.
  await expect(rows.first()).toHaveAttribute("data-on", "");

  await expect(viewer.locator('[data-k="i-capture"]')).toHaveText(
    `capture 1 / ${total}`,
  );

  // Automation can stall a headless frame too, and a stall within ten frames of a spike
  // joins its capture as the longer frame. Open the capture, then step to the frame the
  // fixture made heavy.
  const spike = rows.filter({ hasText: "spawn ×184" }).first();

  await spike.getByRole("button").click();

  await expect(spike).toHaveAttribute("data-on", "");

  const shownFrame = async () =>
    Number(
      (await viewer.locator('[data-k="i-frame"]').textContent())?.replace(
        /\D/g,
        "",
      ),
    );

  const opened = await shownFrame();

  const spikeFrames = await page.evaluate(() => window.fixture.spikeFrames);

  expect(spikeFrames).toHaveLength(3);

  const heavy = spikeFrames.reduce((best, id) =>
    Math.abs(id - opened) < Math.abs(best - opened) ? id : best,
  );

  const playhead = viewer.getByRole("slider", { name: "Playhead" });

  await playhead.focus();

  /* oxlint-disable no-await-in-loop */
  for (let i = 0; i < Math.abs(heavy - opened); i++)
    await viewer.keyboard.press(heavy > opened ? "ArrowRight" : "ArrowLeft");

  /* oxlint-enable no-await-in-loop */
  await expect.poll(shownFrame).toBe(heavy);

  await expect(viewer.locator('[data-k="i-likely"]')).toHaveText(
    "scene update",
  );

  await expect(viewer.locator('[data-k="i-ms"]')).toHaveAttribute(
    "data-tone",
    "miss",
  );

  // Back on the capture for the navigation checks below.
  await spike.getByRole("button").click();

  await expect.poll(shownFrame).toBe(opened);

  // GPU samples are periodic: the section shows passes or says the frame has none.
  await expect(viewer.locator('[data-k="i-gpu"]')).toContainText(
    /no sample from this frame|shadow/,
  );

  const first = await playhead.getAttribute("aria-valuenow");

  await playhead.focus();

  await viewer.keyboard.press("Shift+ArrowRight");

  await expect(playhead).toHaveAttribute(
    "aria-valuenow",
    String(Number(first) + 10),
  );

  // Off a capture, ] goes to capture 1; then ] and [ step through them.
  await viewer.keyboard.press("]");

  await expect(viewer.locator('[data-k="i-capture"]')).toHaveText(
    `capture 1 / ${total}`,
  );

  await viewer.keyboard.press("]");

  await expect(viewer.locator('[data-k="i-capture"]')).toHaveText(
    `capture 2 / ${total}`,
  );

  await viewer.keyboard.press("[");

  await expect(viewer.locator('[data-k="i-capture"]')).toHaveText(
    `capture 1 / ${total}`,
  );

  const downloading = viewer.waitForEvent("download");

  await viewer.getByRole("button", { name: "EXPORT CAPTURE" }).click();

  const capture = await downloading;

  expect(capture.suggestedFilename()).toBe("jank-recording-capture-1.json");

  const kept = parseRecording(await readFile(await capture.path(), "utf8"));

  expect(
    kept.frames.some((frame) => frame.id === kept.capture.triggerFrame),
  ).toBe(true);

  expect((await new AxeBuilder({ page: viewer }).analyze()).violations).toEqual(
    [],
  );

  if (info.project.name === "chromium") {
    await spike.getByRole("button").click();

    await mkdir("artifacts/screenshots", { recursive: true });

    await viewer.screenshot({ path: boardShot("viewer.png") });
  }

  // Below 1100 px the inspector sits under the timeline.
  await viewer.setViewportSize({ width: 900, height: 900 });

  const timeline = await viewer.locator(".jank-viewer-timeline").boundingBox();

  const inspector = await viewer
    .getByRole("complementary", { name: "Frame inspector" })
    .boundingBox();

  expect(inspector!.y).toBeGreaterThan(timeline!.y + timeline!.height);

  expect(seen).toEqual([]);
});
