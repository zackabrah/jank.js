import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`overview window pans at fixed width and dotted handles resize in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto(`/checks/viewer.html?theme=${theme}`);
    const first = page.getByRole("slider", { name: "First visible frame", exact: true });
    const last = page.getByRole("slider", { name: "Last visible frame", exact: true });
    const selected = page.getByRole("slider", { name: "Selected frame", exact: true });
    const brush = page.locator("[data-overview-brush]");
    const bounds = await brush.boundingBox();
    if (!bounds) throw new Error("Missing overview");
    // Firefox delivers no mouse events past the viewport edge, so stay just inside it.
    const point = (index: number) =>
      Math.max(0, Math.min(1439, bounds.x + (bounds.width * (index + 0.5)) / 360));
    const drag = async (from: number, to: number) => {
      await page.mouse.move(point(from), bounds.y + 30);
      await page.mouse.down();
      await page.mouse.move(point(to), bounds.y + 30, { steps: 4 });
      await page.mouse.up();
    };
    await drag(200, 220);
    await expect(first).toHaveAttribute("aria-valuenow", "0");
    await expect(last).toHaveAttribute("aria-valuenow", "359");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    // Clicking inside keeps the range; moving either direction preserves its width.
    await drag(200, 200);
    await expect(first).toHaveAttribute("aria-valuenow", "152");
    await expect(last).toHaveAttribute("aria-valuenow", "331");
    await drag(200, 210);
    await expect(first).toHaveAttribute("aria-valuenow", "162");
    await expect(last).toHaveAttribute("aria-valuenow", "341");
    await drag(200, 160);
    await expect(first).toHaveAttribute("aria-valuenow", "122");
    await expect(last).toHaveAttribute("aria-valuenow", "301");
    await expect(selected).toHaveAttribute("aria-valuenow", "242");
    await drag(200, 400);
    await expect(first).toHaveAttribute("aria-valuenow", "180");
    await expect(last).toHaveAttribute("aria-valuenow", "359");
    await drag(250, -20);
    await expect(first).toHaveAttribute("aria-valuenow", "0");
    await expect(last).toHaveAttribute("aria-valuenow", "179");
    await expect(selected).toHaveAttribute("aria-valuenow", "179");
    await page.mouse.move(point(100), bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(point(150), bounds.y + 30);
    await expect(first).toHaveAttribute("aria-valuenow", "50");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(first).toHaveAttribute("aria-valuenow", "0");
    await expect(last).toHaveAttribute("aria-valuenow", "179");
    // Hit the grip's child SVG directly so it cannot accidentally start a pan.
    await first.locator("circle").first().hover();
    await page.mouse.down();
    await page.mouse.move(point(20), bounds.y + 30);
    await page.mouse.up();
    await expect(first).toHaveAttribute("aria-valuenow", "20");
    await expect(last).toHaveAttribute("aria-valuenow", "179");
    await last.locator("circle").first().hover();
    await page.mouse.down();
    await page.mouse.move(point(160), bounds.y + 30);
    await page.mouse.up();
    await expect(first).toHaveAttribute("aria-valuenow", "20");
    await expect(last).toHaveAttribute("aria-valuenow", "160");
    await last.press("ArrowLeft");
    await expect(last).toHaveAttribute("aria-valuenow", "159");
    await info.attach(`range grips ${theme}`, {
      body: await brush.screenshot(),
      contentType: "image/png",
    });
  });

  test(`viewer selection, brush, zoom and inspector stay synchronized in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/viewer.html?theme=${theme}`);
    const selected = page.getByRole("slider", { name: "Selected frame", exact: true });
    const first = page.getByRole("slider", { name: "First visible frame", exact: true });
    const last = page.getByRole("slider", { name: "Last visible frame", exact: true });
    const readout = page.locator("[data-range-readout]");
    const frame = page.getByRole("region", { name: "Selected frame details" });
    await expect(frame).toContainText("Frame f1485");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(readout).toContainText("180 frames");
    await selected.focus();
    await selected.press("k");
    await expect(frame).toContainText("Frame f1671");
    await expect(readout).toContainText("f1313 – f1671 · 180 frames");
    await selected.press("j");
    await expect(frame).toContainText("Frame f1485");
    await selected.press("j");
    await expect(frame).toContainText("Frame f1335");
    await selected.press("w");
    await expect(frame).toContainText("Frame f1485");
    await selected.press("End");
    await expect(last).toHaveAttribute("aria-valuenow", "359");
    await expect(selected).toHaveAttribute("aria-valuenow", "359");
    await selected.press("Home");
    await expect(first).toHaveAttribute("aria-valuenow", "0");
    await expect(selected).toHaveAttribute("aria-valuenow", "0");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(readout).toContainText("360 frames");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const brush = page.locator("[data-overview-brush]");
    const bounds = await brush.boundingBox();
    if (!bounds) throw new Error("Missing overview");
    // Reverse drag from frame position 200 to 100; IDs deliberately have gaps.
    await page.mouse.move(bounds.x + (bounds.width * 200.5) / 360, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + (bounds.width * 100.5) / 360, bounds.y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(first).toHaveAttribute("aria-valuenow", "100");
    await expect(last).toHaveAttribute("aria-valuenow", "200");
    await expect(readout).toContainText("f1201 – f1401 · 101 frames");
    await expect(frame).toContainText("Frame f1201");
    await first.focus();
    await first.press("ArrowRight");
    await expect(first).toHaveAttribute("aria-valuenow", "101");
    await expect(frame).toContainText("Frame f1203");
    await last.focus();
    await last.press("Home");
    await expect(readout).toContainText("f1203 – f1203 · 1 frame");
    await selected.press("ArrowRight");
    await expect(readout).toContainText("f1205 – f1205 · 1 frame");
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(readout).toContainText("2 frames");
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.getByRole("button", { name: "Worst", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.locator("[data-frame-readout]").click();
    const plot = await selected.boundingBox();
    if (!plot) throw new Error("Missing timeline");
    await selected.click({ position: { x: 1, y: plot.height / 2 } });
    await expect(selected).toHaveAttribute(
      "aria-valuenow",
      (await first.getAttribute("aria-valuenow")) ?? "",
    );
    await page.getByRole("button", { name: "Worst", exact: true }).click();
    await info.attach(`viewer ${theme}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const inspector = await page
      .getByRole("complementary", { name: "Frame inspector" })
      .boundingBox();
    expect(inspector?.x).toBeGreaterThan(plot.x + plot.width);
    expect(errors).toEqual([]);
  });
}

test("cancelled brush and invalid imports preserve navigation; a replacement resets it", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?large");
  const selected = page.getByRole("slider", { name: "Selected frame", exact: true });
  const readout = page.locator("[data-range-readout]");
  await expect(readout).toContainText("6000 frames");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await readout.textContent();
  const brush = await page.locator("[data-overview-brush]").boundingBox();
  if (!brush) throw new Error("Missing overview");
  await page.mouse.move(brush.x + brush.width / 2, brush.y + 30);
  await page.mouse.down();
  await page.mouse.move(brush.x + brush.width * 0.75, brush.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(readout).toHaveText(before ?? "");
  const file = page.getByLabel("Open recording or comparison file");
  await file.setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText("current recording is still open");
  await expect(readout).toHaveText(before ?? "");
  // Replacing a file during a drag must not restore the old range on capture loss.
  const replacementBrush = await page.locator("[data-overview-brush]").boundingBox();
  if (!replacementBrush) throw new Error("Missing overview after failed import");
  await page.mouse.move(replacementBrush.x + replacementBrush.width / 3, replacementBrush.y + 30);
  await page.mouse.down();
  await page.mouse.move(replacementBrush.x + replacementBrush.width / 2, replacementBrush.y + 30);
  await expect(readout).not.toHaveText(before ?? "");
  await file.setInputFiles({
    name: "single.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "world-performance-recording",
        version: 1,
        units: "milliseconds",
        frameCapacity: 6000,
        frames: [{ at: 16, interval: 16, update: 0, render: 0 }],
        samples: [],
        systems: [],
        events: [],
      }),
    ),
  });
  await expect(readout).toContainText("f1 – f1 · 1 frame");
  await page.mouse.up();
  await expect(selected).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Next slow K", exact: true }).click();
  await selected.press("End");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(selected).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.locator('svg path[d*="NaN"], svg path[d*="Infinity"]').count()).toBe(0);
});

test("fast range drags retain their final position when pointer capture is released", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const brush = page.locator("[data-overview-brush]");
  const first = page.getByRole("slider", { name: "First visible frame", exact: true });
  const last = page.getByRole("slider", { name: "Last visible frame", exact: true });
  const bounds = await brush.boundingBox();
  if (!bounds) throw new Error("Missing overview");
  const x = (index: number) => bounds.x + (bounds.width * (index + 0.5)) / 360;
  await page.mouse.move(x(200), bounds.y + 30);
  await page.mouse.down();
  await brush.evaluate((element) => {
    // Release capture before pointerup, as when the browser interrupts a gesture.
    element.addEventListener(
      "pointermove",
      (event) => element.releasePointerCapture((event as PointerEvent).pointerId),
      { once: true },
    );
  });
  await page.mouse.move(x(160), bounds.y + 30);
  await page.mouse.up();
  await expect(first).toHaveAttribute("aria-valuenow", "112");
  await expect(last).toHaveAttribute("aria-valuenow", "291");
  await page.mouse.move(x(220), bounds.y + 30);
  await expect(first).toHaveAttribute("aria-valuenow", "112");
  // A second fast drag must start from the completed range, without intermediate moves.
  await page.mouse.down();
  await page.mouse.move(x(240), bounds.y + 30);
  await page.mouse.up();
  await expect(first).toHaveAttribute("aria-valuenow", "132");
  await expect(last).toHaveAttribute("aria-valuenow", "311");
});
