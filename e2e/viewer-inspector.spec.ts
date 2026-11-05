import { expect, test } from "@playwright/test";
import { recordingFixture } from "../src/recording/fixtures.ts";

for (const theme of ["dark", "light"]) {
  test(`inspector tabs, counter pins and stable shared tracks in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto(`/checks/viewer.html?theme=${theme}`);
    const frame = page.getByRole("slider", { name: "Selected frame", exact: true });
    const frameTab = page.getByRole("tab", { name: "Frame", exact: true });
    const recordingTab = page.getByRole("tab", { name: "Recording", exact: true });
    await frameTab.press("ArrowRight");
    await expect(recordingTab).toBeFocused();
    await expect(recordingTab).toHaveAttribute("aria-selected", "true");
    await expect(frame).toHaveAttribute("aria-valuenow", "242");
    await expect(page.getByRole("region", { name: "Recording metadata" })).toContainText(
      "360 / 6000",
    );
    await recordingTab.press("End");
    await expect(page.getByRole("region", { name: "Current capture" })).toContainText("automatic");
    await page.getByRole("button", { name: "Inspect trigger", exact: true }).click();
    await expect(frameTab).toHaveAttribute("aria-selected", "true");
    await expect(frameTab).toBeFocused();
    const counters = page.getByRole("region", { name: "Frame counters", exact: true });
    const calls = counters
      .locator("[data-counter-id]")
      .filter({ has: page.getByRole("button", { name: "Pin Renderer drawCalls", exact: true }) });
    await expect(calls).toContainText("144");
    await expect(calls).toContainText("Δ +6 · 33.2 ms old");
    await expect(counters).toContainText("Unavailable");
    await counters.getByRole("button", { name: "Pin Renderer drawCalls", exact: true }).click();
    const pins = page.getByRole("region", { name: "Pinned counters", exact: true });
    const lane = pins.getByRole("slider", { name: "Renderer drawCalls counter lane" });
    await expect(lane).toHaveAttribute("aria-valuetext", /144 · 33.2\sms old/);
    for (const key of ["triangles", "memoryBytes", "balance"]) {
      await pins.getByLabel("Counter to pin").selectOption(JSON.stringify(["renderer", key]));
      await pins.getByRole("button", { name: "Pin", exact: true }).click();
    }
    await expect(pins.getByRole("slider")).toHaveCount(4);
    await expect(
      counters.getByRole("button", { name: "Pin Renderer uploads", exact: true }),
    ).toBeDisabled();
    await expect(
      pins
        .getByRole("slider", { name: "Renderer memoryBytes counter lane" })
        .locator("[data-counter-missing]"),
    ).not.toHaveAttribute("d", "");
    const tracks = page
      .getByRole("region", { name: "Recording timeline", exact: true })
      .getByRole("slider");
    const layout = () =>
      tracks.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, width: rect.width, height: rect.height };
        }),
      );
    const before = await layout();
    expect(new Set(before.map((rect) => `${rect.x}:${rect.width}`)).size).toBe(1);
    await lane.hover();
    expect(await layout()).toEqual(before);
    await lane.press("Home");
    await expect(frame).toHaveAttribute("aria-valuenow", "0");
    await expect(lane).toHaveAttribute("aria-valuetext", /120 · 0.0\sms old/);
    await lane.press("w");
    await expect(frame).toHaveAttribute("aria-valuenow", "242");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(lane).toHaveAttribute("aria-valuenow", "242");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await pins.getByRole("button", { name: "Unpin Renderer balance lane" }).click();
    await expect(pins.getByLabel("Counter to pin")).toBeFocused();
    await expect(pins.getByRole("slider")).toHaveCount(3);
    await frame.press("?");
    await expect(page.getByRole("heading", { name: "Viewer shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Viewer shortcuts" })).toBeHidden();
    await expect(page.getByText("Shortcuts ?", { exact: true })).toBeFocused();
    await page.setViewportSize({ width: 1024, height: 604 });
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await info.attach(`inspector ${theme} desktop minimum`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("frame evidence copying, counter filtering and file replacement preserve honest state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.setAttribute("data-copied-frame", text);
        },
      },
    });
  });
  await page.goto("/checks/viewer.html");
  const frameTab = page.getByRole("tab", { name: "Frame", exact: true });
  await page.getByRole("button", { name: "Copy frame JSON", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Frame f1485 copied." })).toBeVisible();
  const copied = JSON.parse(
    (await page.locator("html").getAttribute("data-copied-frame")) ?? "null",
  );
  expect(copied.frame.id).toBe(1485);
  expect(copied.gpuTiming.frameId).toBe(1485);
  expect(copied.counters.sample.at).toBeLessThanOrEqual(copied.counters.frameStart);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy frame JSON", exact: true }).click();
  await expect(page.getByRole("region", { name: "Frame JSON to copy" })).toContainText(
    '"frameStart"',
  );
  await page.getByRole("button", { name: /^Evidence/ }).click();
  await expect(page.getByText(/Raw nanoseconds were not retained/)).toBeVisible();
  await page.getByLabel("Filter counters").fill("drawCalls");
  await expect(
    page.getByRole("region", { name: "Frame counters" }).locator("[data-counter-id]"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Pin Renderer drawCalls", exact: true }).click();
  await page.getByRole("tab", { name: "Recording", exact: true }).click();
  expect(
    await page
      .getByRole("complementary", { name: "Frame inspector" })
      .evaluate((el) => el.scrollTop),
  ).toBe(0);
  const file = page.getByLabel("Open recording or comparison file");
  await file.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("bad"),
  });
  await expect(page.getByText(/Couldn't open invalid.json/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Recording", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("region", { name: "Pinned counters" }).getByRole("slider"),
  ).toHaveCount(1);
  await file.setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recordingFixture())),
  });
  await expect(frameTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "Pinned counters" }).getByRole("slider"),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Frame counters" })).toContainText(
    "No counter history",
  );
  await expect(page.getByRole("region", { name: "Frame JSON to copy" })).toHaveCount(0);
  await page.goto("/checks/viewer.html?missing");
  await expect(page.getByRole("region", { name: "Frame counters" })).toContainText(
    "No sample at or before frame start",
  );
  await page.getByRole("button", { name: "Pin Renderer drawCalls", exact: true }).click();
  const missing = page.getByRole("slider", { name: "Renderer drawCalls counter lane" });
  await expect(missing).toHaveAttribute("aria-valuetext", /Unavailable.*No sample/);
  await expect(missing.locator("path").first()).toHaveAttribute("d", "");
});
