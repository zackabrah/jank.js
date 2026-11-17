import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`GPU capture finalizes fixed frames and round-trips evidence in ${theme}`, async ({
    page,
  }, info) => {
    await page.clock.install();
    await page.goto("/checks/gpu.html");
    // Finalization has a 500 ms deadline, and a slower engine can overrun it between steps.
    await page.clock.pauseAt(Date.now() + 1000);
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: `GPU capture · ${theme}`, exact: true }) });
    const recent = section.getByRole("progressbar", { name: "Recent buffer", exact: true });
    await expect(recent).toHaveAttribute("aria-valuenow", "3");
    await expect(recent).toHaveAttribute("aria-valuemax", "180");
    const pool = section.getByRole("progressbar", { name: "GPU detail pool", exact: true });
    if (theme === "dark") {
      await expect(pool).toHaveAttribute("aria-valuemax", "16384");
      await expect(pool).toHaveAttribute("aria-valuenow", "827");
    } else {
      await expect(pool).toHaveCount(0);
      await expect(section.getByText("15,557 passes free", { exact: true })).toBeVisible();
    }
    await section.getByRole("button", { name: "Start recording", exact: true }).click();
    const manual = section.getByRole("region", { name: "Manual recording", exact: true });
    await expect(manual.getByText("No frames yet", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Advance pending GPU frame" }).click();
    await expect(
      manual.getByText("Recording GPU coverage · 1 frame", { exact: true }),
    ).toBeVisible();
    await expect(
      manual.getByText("1 invocation awaiting GPU readback.", { exact: true }),
    ).toBeVisible();
    await info.attach(`Recording coverage ${theme}`, {
      body: await section.screenshot(),
      contentType: "image/png",
    });
    await section.getByRole("button", { name: "Stop and save", exact: true }).click();
    await expect(
      section.getByRole("heading", { name: "Finalizing GPU", exact: true }),
    ).toBeVisible();
    await section.getByRole("button", { name: "Advance pending GPU frame" }).click();
    await expect(recent).toHaveAttribute("aria-valuenow", "5");
    await expect(
      manual.getByText("Recording GPU coverage · 1 frame", { exact: true }),
    ).toBeVisible();
    await section.getByRole("button", { name: "Resolve GPU queries" }).click();
    await page.clock.runFor(32);
    await expect(
      section.getByText("Capture C1 GPU coverage · 1 frame", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("img", {
        name: "1 complete · 0 partial · 0 unknown · 0 missing GPU frame records",
      }),
    ).toBeVisible();
    const row = section.getByRole("listitem", { name: "Capture C1", exact: true });
    await row.getByRole("button", { name: "Open", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
    await expect(viewer.getByText(/Timed GPU work: 0.0\sms/)).toBeVisible();
    await viewer.getByRole("button", { name: /Why this coverage/ }).click();
    await expect(viewer.getByText(/A timed 0\sms result is valid/)).toBeVisible();
    await viewer.getByRole("button", { name: "Why?", exact: true }).click();
    await expect(
      viewer.getByRole("img", {
        name: "1 complete · 0 partial · 0 unknown · 0 missing GPU frame records",
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Why?", exact: true })).toBeFocused();
    const downloading = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Export JSON", exact: true }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error("Missing GPU capture export");
    const buffer = await readFile(path);
    const payload = JSON.parse(buffer.toString());
    expect(payload.frames).toHaveLength(1);
    expect(payload.gpuTiming.frames[0].invocations[0].milliseconds).toBe(0);
    await viewer
      .getByLabel("Open recording or comparison file")
      .setInputFiles({ name: "gpu-roundtrip.json", mimeType: "application/json", buffer });
    await expect(viewer.getByText(/Timed GPU work: 0.0\sms/)).toBeVisible();
    await info.attach(`GPU viewer ${theme}`, {
      body: await viewer.screenshot(),
      contentType: "image/png",
    });
    await viewer.getByRole("button", { name: "Close viewer" }).click();
    await info.attach(`GPU panel ${theme}`, {
      body: await section.screenshot(),
      contentType: "image/png",
    });
    expect(
      await section.evaluate((el) =>
        [...el.querySelectorAll("div")].every(
          (node) =>
            !node.shadowRoot ||
            [...node.shadowRoot.querySelectorAll("section")].every(
              (item) => item.scrollWidth <= item.clientWidth,
            ),
        ),
      ),
    ).toBe(true);
  });
}

test("timeout remains partial and a discarded finalization never saves", async ({ page }) => {
  await page.clock.install();
  await page.goto("/checks/gpu.html");
  // Finalization has a 500 ms deadline, and a slower engine can overrun it between steps.
  await page.clock.pauseAt(Date.now() + 1000);
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "GPU capture · dark", exact: true }) });
  await section.getByRole("button", { name: "Start recording", exact: true }).click();
  await section.getByRole("button", { name: "Advance pending GPU frame" }).click();
  await section.getByRole("button", { name: "Stop and save", exact: true }).click();
  await page.clock.runFor(520);
  await expect(
    section.getByRole("img", {
      name: "0 complete · 1 partial · 0 unknown · 0 missing GPU frame records",
    }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Start recording", exact: true }).click();
  await section.getByRole("button", { name: "Advance pending GPU frame" }).click();
  await section.getByRole("button", { name: "Stop and save", exact: true }).click();
  await section.getByRole("button", { name: "Discard", exact: true }).click();
  await section.getByRole("button", { name: "Resolve GPU queries" }).click();
  await page.clock.runFor(520);
  await expect(section.getByRole("listitem", { name: "Capture C2", exact: true })).toHaveCount(0);
});

test("GPU explanations expose retained counts, overflow and rejection reasons in both themes", async ({
  page,
}, info) => {
  await page.goto("/checks/gpu.html");
  for (const theme of ["dark", "light"]) {
    const section = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: `Partial · mixed + overflow · ${theme}`,
        exact: true,
      }),
    });
    const why = section.getByRole("button", { name: /Why this coverage/ });
    await why.focus();
    await why.press("Enter");
    await expect(why).toHaveAttribute("aria-expanded", "true");
    await expect(
      section.getByText("Host-declared invocations: 6 · valid timings: 1.", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText(/2 additional invocations omitted beyond record capacity/),
    ).toBeVisible();
    await expect(
      section.getByText("Pass 3 · render · rejected: GPU counter reset", { exact: true }),
    ).toBeVisible();
    const explanation = section.locator(`#${await why.getAttribute("aria-controls")}`);
    await explanation.scrollIntoViewIfNeeded();
    expect(await explanation.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await info.attach(`GPU explanations ${theme}`, {
      body: await section.screenshot(),
      contentType: "image/png",
    });
  }
});

test("native WebGL2 timer queries resolve or explicitly report unavailable support", async ({
  page,
}) => {
  await page.goto("/checks/gpu.html");
  await page.getByRole("button", { name: "Run native WebGL2 smoke check" }).click();
  await expect(page.locator("#native-result")).toHaveText(
    /WebGL2 (timed frame|unavailable|timer extension unavailable)/,
    { timeout: 15000 },
  );
  console.log(await page.locator("#native-result").textContent());
});
