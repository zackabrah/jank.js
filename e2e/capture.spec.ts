import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("record, freeze, capacity-save, inspect, export and re-import a recording", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.goto("/checks/capture.html");
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Idle · dark", exact: true }) });
  const surface = panel.getByRole("region", { name: "Live performance panel" });
  await panel.getByRole("button", { name: "Start recording", exact: true }).click();
  await panel.getByRole("button", { name: "Freeze", exact: true }).click();
  const held = await surface.getAttribute("data-frame");
  const advance = panel.getByRole("button", { name: "Advance 4 reference frames" });
  await advance.click();
  await expect(panel.getByRole("progressbar", { name: "Recording capacity" })).toHaveAttribute(
    "aria-valuenow",
    "4",
  );
  await advance.click();
  await advance.click();
  await expect(panel.getByRole("tab", { name: "Capture (1)" })).toBeVisible();
  await expect(surface).toHaveAttribute("data-frame", held ?? "");
  const notice = panel.getByRole("status", { name: "Capture C1 saved", exact: true });
  await expect(panel.locator("[data-panel-notice]")).toHaveCount(1);
  const savedDownload = page.waitForEvent("download");
  await notice.getByRole("button", { name: "Export capture C1" }).click();
  expect((await savedDownload).suggestedFilename()).toBe("capture-C1.json");
  const open = notice.getByRole("button", { name: "Open", exact: true });
  // Safari does not focus buttons on click, so only keyboard use has focus to return.
  if (testInfo.project.name === "webkit") {
    await open.focus();
    await open.press("Enter");
  } else await open.click();
  const viewer = page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
  await expect(viewer.getByRole("heading", { name: /^Frame f5/ })).toBeVisible();
  await page.clock.runFor(9000);
  await expect(viewer.getByText("12 frames · 0.30 s · 60 FPS target")).toBeVisible();
  await expect(viewer.getByRole("definition").filter({ hasText: "f5" })).toContainText("42.0 ms");
  await viewer.getByRole("button", { name: "Next", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: /^Frame f6/ })).toBeVisible();
  await viewer.getByRole("button", { name: "Worst", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: /^Frame f5/ })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error("Missing downloaded recording");
  const buffer = await readFile(path);
  expect(JSON.parse(buffer.toString()).frames).toHaveLength(12);
  const file = viewer.getByLabel("Open recording or comparison file");
  await file.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("broken"),
  });
  await expect(viewer.getByRole("alert")).toContainText("current recording is still open");
  await expect(viewer.getByRole("alert")).toContainText("broken.json");
  await viewer.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Open file…" })).toBeFocused();
  await expect(viewer.getByRole("heading", { name: /^Frame f5/ })).toBeVisible();
  await file.setInputFiles({ name: "round-trip.json", mimeType: "application/json", buffer });
  await expect(viewer.getByText(/round-trip.json/)).toBeVisible();
  await expect(viewer.getByRole("alert")).toHaveCount(0);
  await testInfo.attach("recording-viewer", {
    body: await viewer.screenshot(),
    contentType: "image/png",
  });
  await viewer.getByRole("button", { name: "Close viewer", exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await expect(open).toBeFocused();
  await panel.getByRole("button", { name: "Dismiss saved capture notice" }).click();
  await expect(
    panel.getByRole("status", { name: "Display frozen; collection continues" }),
  ).toBeVisible();
});

for (const theme of ["dark", "light"]) {
  test(`capture layout, footer and recording rail stay consistent in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.goto("/checks/capture.html");
    const panel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Idle · dark", exact: true }) });
    const surface = panel.getByRole("region", { name: "Live performance panel" });
    if (theme === "light")
      await surface.evaluate((element) => {
        const root = element.getRootNode();
        if (root instanceof ShadowRoot) root.host.classList.add("light-theme");
      });
    const body = panel.getByRole("tabpanel").filter({ visible: true });
    expect((await body.boundingBox())?.height).toBe(576);
    const footer = surface.locator("footer");
    await expect(footer).toContainText("Overhead");
    const footerY = (await footer.boundingBox())?.y;
    await panel.getByRole("button", { name: "Start recording", exact: true }).click();
    await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
    await expect(panel.getByRole("region", { name: "Manual recording" })).toHaveAttribute(
      "data-recording",
      "",
    );
    expect((await footer.boundingBox())?.y).toBe(footerY);
    await testInfo.attach(`recording-card-${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await panel.getByRole("tab", { name: "Live", exact: true }).click();
    expect((await footer.boundingBox())?.y).toBe(footerY);
    const rail = panel.getByRole("img", {
      name: "Manual recording: 4 frames in the displayed window",
    });
    await expect(rail).toBeVisible();
    const graphBox = await panel
      .getByRole("slider", { name: "Inspect frame intervals" })
      .boundingBox();
    const railBox = await rail.boundingBox();
    if (!graphBox || !railBox) throw new Error("Missing recording graph geometry");
    expect(railBox.x).toBeCloseTo(graphBox.x, 1);
    expect(railBox.width).toBeCloseTo(graphBox.width, 1);
    expect(Number(await rail.locator("rect").getAttribute("width"))).toBeCloseTo((300 * 4) / 180);
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
    await expect(rail).toBeVisible();
    await expect(body).toHaveCount(1);
    expect((await body.boundingBox())?.height).toBe(576);
    await testInfo.attach(`recording-rail-${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await panel.getByRole("button", { name: "Mini view", exact: true }).click();
    await expect(rail).toBeVisible();
    await expect(footer).toBeHidden();
    await panel.getByRole("button", { name: /^Expand to full panel/ }).click();
    await panel.getByRole("tab", { name: /^Capture/ }).click();
    await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
    await expect(surface.locator("[data-panel-notice]")).toHaveCount(1);
    await expect(panel.locator('[aria-label="Capture C1"]')).toContainText(
      "Manual · worst 42.0 ms",
    );
    await expect(panel.locator('[aria-label="Capture C1"]')).toContainText("GPU not recorded");
    expect((await body.boundingBox())?.height).toBe(576);
  });
}

test("discard leaves saved captures intact and returns focus to Start", async ({ page }) => {
  await page.goto("/checks/capture.html");
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Saved · dark", exact: true }) });
  await panel.getByRole("button", { name: "Start recording", exact: true }).click();
  await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
  await panel.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Capture (3)" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Start recording", exact: true })).toBeFocused();
  await expect(
    panel.getByRole("progressbar", { name: "Recording capacity", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("progressbar", { name: "Recent buffer", exact: true }),
  ).toBeVisible();
});

test("standalone viewer accepts a file and handles empty recordings", async ({ page }) => {
  await page.goto("/viewer.html");
  await expect(page.getByRole("heading", { name: "Recording viewer", exact: true })).toBeVisible();
  await page.getByLabel("Open recording or comparison file").setInputFiles({
    name: "empty.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "world-performance-recording",
        version: 1,
        units: "milliseconds",
        frameCapacity: 6000,
        frames: [],
        samples: [],
        systems: [],
        events: [],
      }),
    ),
  });
  await expect(page.getByText("This recording contains no completed frames.")).toBeVisible();
});

for (const theme of ["dark", "light"]) {
  test(`automatic capture survives Freeze and compact modes in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/checks/capture.html");
    const panel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Idle · dark", exact: true }) });
    const surface = panel.getByRole("region", { name: "Live performance panel" });
    if (theme === "light")
      await surface.evaluate((element) => {
        const root = element.getRootNode();
        if (root instanceof ShadowRoot) root.host.classList.add("light-theme");
      });
    const auto = panel.getByRole("button", { name: "Auto", exact: true });
    const toggle = panel.getByRole("switch", { name: "Automatic capture" });
    await toggle.click();
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await panel.getByRole("button", { name: "Inject 48 ms spike" }).click();
    await expect(
      panel.getByRole("progressbar", { name: "Automatic after-context" }),
    ).toHaveAttribute("aria-valuenow", "0");
    await testInfo.attach(`automatic-capturing-${theme}`, {
      body: await surface.screenshot(),
      contentType: "image/png",
    });
    await panel.getByRole("tab", { name: "Live", exact: true }).click();
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    const held = await surface.getAttribute("data-frame");
    const rail = panel.getByRole("img", { name: /^Automatic capture:/ });
    await expect(rail.locator("[data-trigger-frame]")).toHaveAttribute("data-trigger-frame", "4");
    const width = await rail.locator("rect").getAttribute("width");
    await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
    await expect(rail.locator("rect")).toHaveAttribute("width", width ?? "");
    await panel.getByRole("button", { name: "Mini view", exact: true }).click();
    await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
    await expect(surface).toHaveAttribute("data-frame", held ?? "");
    await panel.getByRole("button", { name: "Line view", exact: true }).click();
    await panel.getByRole("button", { name: "Advance 5 seconds" }).click();
    await panel.getByRole("button", { name: /^Expand to full panel/ }).click();
    await panel.getByRole("tab", { name: "Capture (1)", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByText("Waiting for a spike", { exact: true })).toBeVisible();
    await expect(panel.locator('[aria-label="Capture C1"]')).toContainText("Auto · spike 48.0 ms");
    await expect(panel.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
    const saved = panel.getByRole("status", { name: "Capture C1 saved", exact: true });
    await saved.getByRole("button", { name: "Open", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
    await expect(viewer.getByRole("heading", { name: /^Frame f4/ })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Export JSON", exact: true }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error("Missing automatic export");
    const recording = JSON.parse(await readFile(path, "utf8"));
    expect(recording.capture.mode).toBe("automatic");
    expect(recording.capture.triggerFrame).toBe(4);
    expect(recording.frames).toHaveLength(10);
    await viewer.getByRole("button", { name: "Close viewer", exact: true }).click();
    await testInfo.attach(`automatic-saved-${theme}`, {
      body: await surface.screenshot(),
      contentType: "image/png",
    });
    const overflow = await surface.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await panel.getByRole("button", { name: "Start recording", exact: true }).click();
    await expect(auto).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await auto.click({ force: true });
    await expect(surface.locator("[data-panel-notice]")).toHaveCount(1);
    await expect(surface.locator("[data-panel-notice]")).toContainText("The recording continues.");
    await toggle.click({ force: true });
    await expect(panel.getByRole("button", { name: "Stop and save", exact: true })).toHaveCount(1);
    await panel.getByRole("tab", { name: "Live", exact: true }).click();
    await auto.focus();
    await page.keyboard.press("a");
    await expect(
      surface
        .locator("[data-panel-notice]")
        .getByRole("button", { name: "Stop and save", exact: true }),
    ).toBeVisible();
    await surface
      .locator("[data-panel-notice]")
      .getByRole("button", { name: "Stop and save", exact: true })
      .click();
    await expect(toggle).toHaveAttribute("aria-disabled", "false");
    await auto.focus();
    await page.keyboard.press("a");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
}
