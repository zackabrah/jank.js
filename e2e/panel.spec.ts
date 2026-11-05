import { expect, test } from "@playwright/test";

test("temporal history counters hold through Freeze and show a host reset in both themes", async ({
  page,
}, info) => {
  await page.goto("/checks/live.html");
  for (const theme of ["dark", "light"]) {
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", { name: `Full · ${theme}`, exact: true }),
    });
    await panel.getByRole("button", { name: /^.*Counters/ }).click();
    const counters = panel.locator('dl[aria-label="Render submission counters"]');
    const counter = (label: string) =>
      counters
        .locator("div")
        .filter({
          has: page.getByText(label, { exact: true }),
        })
        .locator("dd");
    await expect(counter("Temporal History Valid")).toHaveText("Yes");
    await expect(counter("Temporal History Age Frames")).toHaveText("32");
    const freeze = panel.getByRole("button", { name: "Freeze", exact: true });
    await freeze.click();
    await panel.getByRole("button", { name: "Invalidate reference history" }).click();
    await expect(counter("Temporal History Valid")).toHaveText("Yes");
    await freeze.click();
    await expect(counter("Temporal History Valid")).toHaveText("No");
    await expect(counter("Temporal History Age Frames")).toHaveText("0");
    await expect(counter("Temporal History Reset Reason")).toHaveText("Camera cut (reference)");
    await counter("Temporal History Reset Reason").scrollIntoViewIfNeeded();
    expect(await counters.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await info.attach(`Temporal counters ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
  }
});

test("custom budget Apply and Cancel close the editor and preserve the saved value", async ({
  page,
}) => {
  await page.goto("/checks/live.html");
  await expect(page.getByText(/^PASS: 14 panels/)).toBeVisible();
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Full · dark", exact: true }) });
  const budget = panel.getByRole("combobox", { name: "Frame budget" });
  const field = panel.getByRole("spinbutton", { name: "Custom budget (ms)" });
  await budget.selectOption("custom");
  await field.fill("20");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(field).toBeHidden();
  await expect(budget).toHaveValue("current");
  await expect(budget).toBeFocused();
  await budget.selectOption("custom");
  await expect(field).toHaveValue("20");
  await field.fill("0");
  await panel.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("between 1 and 1000");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(field).toBeHidden();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await budget.selectOption("custom");
  await expect(field).toHaveValue("20");
});

test("mode shortcuts preserve visible focus and stay out of form entry", async ({ page }) => {
  await page.goto("/checks/live.html");
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Full · dark", exact: true }) });
  const surface = panel.getByRole("region", { name: "Live performance panel" });
  await panel.getByRole("button", { name: "Mini view", exact: true }).click();
  const expand = panel.getByRole("button", { name: /^Expand to full panel/ });
  await expect(surface).toHaveAttribute("data-mode", "mini");
  await expect(expand).toBeFocused();
  await expand.press("m");
  await expect(surface).toHaveAttribute("data-mode", "line");
  await expect(expand).toBeFocused();
  await expand.press("m");
  await expect(surface).toHaveAttribute("data-mode", "full");
  await panel.getByRole("button", { name: "Freeze", exact: true }).press("f");
  await expect(surface).toHaveAttribute("data-frozen", "");
  const select = panel.getByRole("combobox", { name: "Frame budget" });
  await select.focus();
  await select.press("m");
  await expect(surface).toHaveAttribute("data-mode", "full");
});

test("desktop review states fit in both themes", async ({ page }, testInfo) => {
  await page.goto("/checks/capture.html");
  await expect(page.getByText(/^PASS: eight capture states/)).toBeVisible();
  await testInfo.attach("capture-states", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("LIVE graph supports hover and keyboard inspection in both themes, including Freeze", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/checks/live.html");
  await expect(page.getByText(/^PASS: 14 panels/)).toBeVisible();
  for (const theme of ["dark", "light"]) {
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", { name: `Full · ${theme}`, exact: true }),
    });
    const graph = panel.getByRole("slider", { name: "Inspect frame intervals" });
    const readout = panel.locator('[data-chart="readout"]');
    await expect(readout).toHaveText("Worst f1204 · 32.0 ms · +15.3 ms vs budget");
    const box = await graph.boundingBox();
    if (!box) throw new Error("Missing graph bounds");
    await graph.hover({ position: { x: 1, y: 8 } });
    await expect(readout).toContainText("f1067");
    const readoutBox = await readout.boundingBox();
    if (!readoutBox) throw new Error("Missing inspection readout");
    expect(box.x).toBeCloseTo(readoutBox.x, 1);
    expect(box.width).toBeCloseTo(readoutBox.width, 1);
    // The scale overlays must not intercept inspection near the right edge.
    await graph.hover({ position: { x: box.width - 12, y: 8 } });
    await expect(readout).not.toContainText("f1067");
    await graph.hover({ position: { x: box.width - 1, y: 8 } });
    await expect(readout).toContainText("f1246");
    // Frames are under 2px wide and WebKit's mouse coordinates are whole pixels: land on one.
    const frame137 = Math.round(box.x + box.width * (137.5 / 180)) - box.x;
    await graph.hover({ position: { x: frame137, y: 30 } });
    await expect(readout).toHaveText("f1204 · 32.0 ms · +15.3 ms vs budget");
    await expect(panel.locator('[data-chart="inspection"]')).toBeAttached();
    await page.mouse.move(0, 0);
    await expect(readout).toHaveText("Worst f1204 · 32.0 ms · +15.3 ms vs budget");
    await graph.focus();
    await graph.press("Home");
    await expect(graph).toHaveAttribute("aria-valuetext", /^Frame 1067, 17.9 milliseconds/);
    await graph.press("ArrowRight");
    await expect(graph).toHaveAttribute("aria-valuetext", /^Frame 1068,/);
    await graph.press("End");
    await expect(graph).toHaveAttribute("aria-valuenow", "179");
    await graph.press("f");
    await expect(panel.getByRole("region", { name: "Live performance panel" })).toHaveAttribute(
      "data-frozen",
      "",
    );
    await graph.press("ArrowLeft");
    await expect(readout).toContainText("f1245");
    await expect(graph).toBeFocused();
    await testInfo.attach(`graph-${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await graph.press("f");
    await panel.getByRole("button", { name: "Mini view", exact: true }).click();
    await expect(graph).toBeHidden();
    await expect(panel.getByRole("button", { name: /^Expand to full panel/ })).toBeFocused();
  }
  const empty = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Waiting", exact: true }),
  });
  await expect(empty.getByRole("slider")).toHaveCount(0);
  await expect(empty.locator('[data-chart="readout"]')).toHaveText("No frame samples");
});

test("LIVE event markers align with frames, support keyboard inspection and freeze with the list", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/checks/live.html");
  for (const theme of ["dark", "light"]) {
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", { name: `Full · ${theme}`, exact: true }),
    });
    const rail = panel.getByRole("slider", { name: "Inspect events", exact: true });
    const graph = panel.getByRole("slider", { name: "Inspect frame intervals", exact: true });
    const marker = panel.locator('[data-event-frame="1204"]');
    const details = panel.locator("[data-event-readout]");
    const frameReadout = panel.locator('[data-chart="readout"]');
    await expect(details).toHaveCount(0);
    await expect(marker).toHaveAttribute("data-event-count", "2");
    const graphBox = await graph.boundingBox();
    const railBox = await rail.boundingBox();
    const markerBox = await marker.boundingBox();
    if (!graphBox || !railBox || !markerBox) throw new Error("Missing chart geometry");
    expect(railBox.x).toBeCloseTo(graphBox.x, 1);
    expect(railBox.width).toBeCloseTo(graphBox.width, 1);
    expect(markerBox.x + markerBox.width / 2).toBeCloseTo(
      graphBox.x + graphBox.width * (137.5 / 180),
      1,
    );
    expect(markerBox.y + markerBox.height / 2).toBeCloseTo(graphBox.y + graphBox.height, 1);
    await graph.hover({ position: { x: graphBox.width / 2, y: 30 } });
    await expect(panel.locator('[data-chart="readout"]')).toBeVisible();
    expect((await rail.boundingBox())?.y).toBeCloseTo(railBox.y, 1);
    await rail.hover({ position: { x: railBox.width * (137.5 / 180), y: 12 } });
    await expect(rail).toHaveAttribute("aria-valuetext", /Wave 3.*f1204.*Spawned 128/);
    await expect(details).toContainText("Wave 3");
    await expect(frameReadout).toBeHidden();
    await page.mouse.move(0, 0);
    await expect(details).toHaveCount(0);
    await expect(frameReadout).toBeVisible();
    await expect(frameReadout).toHaveText("Worst f1204 · 32.0 ms · +15.3 ms vs budget");
    await rail.focus();
    await expect(details).toContainText("Spawn complete");
    await expect(frameReadout).toBeHidden();
    await rail.press("Home");
    await expect(details).toContainText("Loaded");
    await expect(rail).toHaveAttribute("aria-valuetext", /Event 1 of 3: Loaded/);
    await rail.press("ArrowRight");
    await expect(rail).toHaveAttribute("aria-valuetext", /Event 2 of 3: Wave 3/);
    await rail.press("ArrowRight");
    await expect(rail).toHaveAttribute("aria-valuetext", /Event 3 of 3: Spawn complete.*f1204/);
    await expect(rail).toBeFocused();
    await rail.press("f");
    await panel.getByRole("button", { name: /^Events/ }).click();
    await expect(details).toHaveCount(0);
    await expect(frameReadout).toBeVisible();
    const list = panel.getByRole("list", { name: "Recent events", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    const held = (await list.textContent()) ?? "";
    await panel.getByRole("button", { name: "Advance reference events", exact: true }).click();
    await expect(list).toHaveText(held);
    await expect(marker).toHaveAttribute("data-event-count", "2");
    await info.attach(`events-${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await expect(list).toContainText("Reference advanced");
    await expect(list.getByText(/no matching frame/)).toHaveCount(3);
    await expect(marker).toHaveCount(0);
    await expect(panel.locator("[data-event-frame]")).toHaveCount(1);
    await expect(rail).toHaveAttribute("aria-valuetext", /Reference advanced.*f1486/);
    await panel.getByRole("button", { name: "Mini view", exact: true }).click();
    await expect(panel.getByRole("slider")).toHaveCount(0);
    const miniEvents = panel.getByRole("img", {
      name: "Events in displayed frames: 1",
      exact: true,
    });
    await expect(miniEvents).toBeVisible();
    const miniGraphBox = await panel.getByRole("img", { name: /frame intervals;/ }).boundingBox();
    const miniMarkerBox = await miniEvents.locator("[data-event-frame]").boundingBox();
    if (!miniGraphBox || !miniMarkerBox) throw new Error("Missing mini graph geometry");
    expect(miniMarkerBox.y + miniMarkerBox.height / 2).toBeCloseTo(
      miniGraphBox.y + miniGraphBox.height,
      1,
    );
    await expect(details).toHaveCount(0);
    const surface = panel.getByRole("region", { name: "Live performance panel" });
    expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
});
