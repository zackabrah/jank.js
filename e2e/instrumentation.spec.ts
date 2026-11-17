import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`instrumentation stays host-owned, keyboard accessible and independent of Freeze in ${theme}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/checks/capture.html");
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Idle · dark", exact: true }),
    });
    const surface = panel.getByRole("region", { name: "Live performance panel" });
    if (theme === "light")
      await surface.evaluate((element) => {
        const root = element.getRootNode();
        if (root instanceof ShadowRoot) root.host.classList.add("light-theme");
      });
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    const held = await surface.getAttribute("data-frame");
    const gpu = panel.getByRole("switch", { name: "GPU timing", exact: true });
    const trace = panel.getByRole("switch", { name: "Trace events", exact: true });
    await gpu.scrollIntoViewIfNeeded();
    await gpu.focus();
    await gpu.press("Space");
    await expect(gpu).not.toBeChecked();
    await expect(gpu).toBeFocused();
    await gpu.press(info.project.name === "webkit" ? "Alt+Tab" : "Tab");
    await expect(trace).toBeFocused();
    await trace.press("Enter");
    await expect(trace).toBeChecked();
    await panel.getByRole("button", { name: "Toggle host GPU timing", exact: true }).click();
    await expect(gpu).toBeChecked();
    await panel.getByRole("button", { name: "Start recording", exact: true }).click();
    await panel.getByRole("button", { name: "Advance 4 reference frames", exact: true }).click();
    await trace.click();
    await expect(trace).not.toBeChecked();
    await expect(surface).toHaveAttribute("data-frame", held ?? "");
    await expect(
      panel.getByRole("progressbar", { name: "Recording capacity", exact: true }),
    ).toHaveAttribute("aria-valuenow", "4");
    await panel
      .getByRole("button", { name: "Reject instrumentation changes", exact: true })
      .click();
    await gpu.click();
    await expect(gpu).toBeChecked();
    await expect(panel.getByRole("alert")).toContainText(
      "Reference host rejected GPU timing change.",
    );
    await expect(surface.locator("[data-panel-notice]")).toHaveCount(1);
    await expect(panel.getByRole("button", { name: "Stop and save", exact: true })).toBeAttached();
    await gpu.scrollIntoViewIfNeeded();
    await info.attach(`instrumentation-${theme}`, {
      body: await surface.screenshot(),
      contentType: "image/png",
    });
    const unsupported = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Recording · dark", exact: true }),
    });
    const absent = unsupported.getByRole("switch", { name: "GPU timing", exact: true });
    await expect(absent).toBeDisabled();
    await expect(absent).toHaveAccessibleDescription(
      "The host has not supplied gpu timing settings.",
    );
    await absent.scrollIntoViewIfNeeded();
    await absent.focus();
    await expect(absent).toBeFocused();
    await absent.press("Space");
    await expect(unsupported.getByRole("alert")).toContainText("host has not supplied");
  });
}
