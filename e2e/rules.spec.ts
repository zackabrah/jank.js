import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`rule drafts, keyboard cancellation and active-rule isolation in ${theme}`, async ({
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
    const edit = panel.getByRole("button", { name: "Edit rule", exact: true });
    await edit.click();
    const form = panel.getByRole("form", { name: "Auto-capture rule" });
    await form.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(panel.getByRole("region", { name: "Auto-capture", exact: true })).toContainText(
      "5 frames before and 6 frames after",
    );
    await panel.getByRole("switch", { name: "Automatic capture" }).click();
    await edit.click();
    await expect(form.getByRole("radio", { name: "Spike", exact: true })).toBeFocused();
    await page.keyboard.press("a");
    await expect(form).toContainText("Still armed with the active rule");
    await form.getByRole("spinbutton", { name: /Frame threshold/ }).fill("999");
    await panel.getByRole("button", { name: "Inject 48 ms spike", exact: true }).click();
    await expect(form).toContainText("Still capturing with the active rule");
    await form.getByRole("button", { name: "Apply and re-arm", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Wait for the current automatic capture");
    await form.getByRole("spinbutton", { name: /Frame threshold/ }).press("Escape");
    await expect(form).toHaveCount(0);
    await expect(edit).toBeFocused();
    await panel.getByRole("button", { name: "Advance 8 quiet frames" }).click();
    await expect(panel.getByRole("tab", { name: "Capture (1)", exact: true })).toBeVisible();
    await edit.click();
    await expect(form.getByRole("spinbutton", { name: /Frame threshold/ })).not.toHaveValue("999");
    await form.getByRole("spinbutton", { name: /Frame threshold/ }).fill("");
    await form.getByRole("radio", { name: "Spike", exact: true }).press("ArrowRight");
    await expect(form.getByRole("radio", { name: "Sustained", exact: true })).toBeChecked();
    await form.getByRole("spinbutton", { name: /Over budget for at least/ }).fill("80");
    await form.getByRole("spinbutton", { name: /Before trigger/ }).fill("99");
    await form.getByRole("button", { name: "Apply and re-arm", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("host limit");
    await form.getByRole("spinbutton", { name: /Before trigger/ }).fill("0.03");
    await testInfo.attach(`rule-editor-${theme}`, {
      body: await surface.screenshot(),
      contentType: "image/png",
    });
    expect(await surface.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      false,
    );
    await expect(form.getByRole("button", { name: "Apply and re-arm", exact: true })).toHaveCount(
      1,
    );
    await expect(form.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(1);
    await form.getByRole("button", { name: "Apply and re-arm", exact: true }).click();
    await expect(edit).toBeFocused();
    await expect(panel.getByRole("region", { name: "Auto-capture", exact: true })).toContainText(
      "for 80 ms",
    );
    await panel.getByRole("button", { name: "Inject 48 ms spike", exact: true }).click();
    await expect(panel.getByRole("progressbar", { name: "Automatic after-context" })).toHaveCount(
      0,
    );
    await panel.getByRole("button", { name: "Inject 48 ms spike", exact: true }).click();
    await expect(panel.getByRole("progressbar", { name: "Automatic after-context" })).toBeVisible();
    await panel.getByRole("button", { name: "Advance 8 quiet frames" }).click();
    await expect(panel.locator('[aria-label="Capture C2"]')).toContainText("Auto · sustained");
    await edit.click();
    await form.getByRole("spinbutton", { name: /Over budget for at least/ }).fill("999");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(edit).toBeFocused();
    await expect(panel.getByRole("region", { name: "Auto-capture", exact: true })).toContainText(
      "for 80 ms",
    );
  });
}

test("whole-episode capture exports its onset, recovery and retained context to the viewer", async ({
  page,
}, testInfo) => {
  await page.goto("/checks/capture.html");
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Idle · dark", exact: true }) });
  await panel.getByRole("button", { name: "Edit rule", exact: true }).click();
  const form = panel.getByRole("form", { name: "Auto-capture rule" });
  await form.getByRole("radio", { name: "Episode", exact: true }).check();
  await expect(form.getByRole("radio", { name: "Whole episode", exact: true })).toBeChecked();
  await form.getByRole("spinbutton", { name: /Over budget for at least/ }).fill("96");
  await form.getByRole("spinbutton", { name: /Before trigger/ }).fill("0.03");
  await form.getByRole("spinbutton", { name: /After episode/ }).fill("0.03");
  await form.getByRole("spinbutton", { name: /Quiet recovery/ }).fill("0.032");
  await form.getByRole("spinbutton", { name: /Cooldown/ }).fill("0");
  await testInfo.attach("episode-editor", {
    body: await form.screenshot(),
    contentType: "image/png",
  });
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel.getByRole("switch", { name: "Automatic capture" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await panel.getByRole("switch", { name: "Automatic capture" }).click();
  await panel.getByRole("button", { name: "Inject 6 slow frames" }).click();
  await expect(panel.getByText(/waiting for 0.032\ss quiet/)).toBeVisible();
  await panel.getByRole("button", { name: "Advance 8 quiet frames" }).click();
  await expect(panel.locator('[aria-label="Capture C1"]')).toContainText("Auto · episode");
  await panel
    .getByRole("status", { name: "Capture C1 saved", exact: true })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
  await expect(viewer.getByRole("heading", { name: /^Frame f5/ })).toBeVisible();
  await viewer.getByRole("tab", { name: "Captures", exact: true }).click();
  const context = viewer.getByRole("region", { name: "Automatic capture context" });
  await expect(context).toContainText("Onset f4 · trigger f5 · end f11");
  await expect(context).toContainText("Quiet recovery reached");
  const downloading = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "Export JSON", exact: true }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Missing episode export");
  const buffer = await readFile(path);
  const recording = JSON.parse(buffer.toString());
  expect(recording.capture.context).toMatchObject({
    reason: "recovered",
    crossings: 6,
    beforeFrames: 2,
    afterFrames: 2,
  });
  expect(recording.frames).toHaveLength(11);
  await viewer
    .getByLabel("Open recording or comparison file")
    .setInputFiles({ name: "episode.json", mimeType: "application/json", buffer });
  await expect(viewer.getByRole("tab", { name: "Frame", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await viewer.getByRole("tab", { name: "Captures", exact: true }).click();
  await expect(context).toContainText("Auto · episode · whole episode");
  await testInfo.attach("episode-context", {
    body: await viewer.screenshot(),
    contentType: "image/png",
  });
});
