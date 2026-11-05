import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`Loading lifecycle, session selection and keyboard tabs in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto("/checks/loading.html");
    const review = page.getByRole("region", { name: `Loading review ${theme}`, exact: true });
    const panel = review.getByRole("region", { name: "Live performance panel" });
    const body = panel.getByRole("tabpanel", { name: /^Loading/ });
    const history = body.getByRole("region", { name: "Loading session history" });
    const picker = body.getByLabel("Session", { exact: true });
    await expect(body.getByRole("status", { name: "Loading session in progress" })).toBeVisible();
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("280 ms");
    await expect(
      panel.getByRole("tab", { name: "Loading, in progress", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await picker.selectOption("1");
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("412 ms");
    await review.getByRole("button", { name: "Advance host snapshot" }).click();
    await expect(picker).toHaveValue("1");
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("412 ms");
    await picker.selectOption("");
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("380 ms");
    const state = review.getByLabel("Reference state");
    await state.selectOption("ready");
    await expect(body.getByRole("status", { name: "Loading session ready" })).toBeVisible();
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("296 ms");
    await expect(history.getByRole("button")).toHaveCount(2);
    await state.selectOption("failed");
    await expect(body.getByRole("alert")).toContainText("2 of 20 reported operations failed");
    await expect(body.getByRole("alert")).toContainText("Reference texture unavailable");
    await expect(panel.getByRole("tab", { name: "Loading, last session failed" })).toBeVisible();
    await info.attach(`Loading failed ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await state.selectOption("cancelled");
    await expect(body.getByRole("status", { name: "Loading session cancelled" })).toBeVisible();
    await expect(body.getByRole("region", { name: "Loading outcomes" })).toContainText(
      "Unfinished at cutoff2",
    );
    await expect(body.getByRole("region", { name: "Loading outcomes" })).toContainText(
      "Completed17",
    );
    await state.selectOption("unknown");
    await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText(
      "Wall timeUnknown",
    );
    await state.selectOption("empty");
    await expect(body).toContainText("No load sessions yet");
    await state.selectOption("disconnected");
    await expect(body).toContainText("No loading source connected");
    const loadingTab = panel.getByRole("tab", { name: "Loading", exact: true });
    await loadingTab.press("Home");
    await expect(panel.getByRole("tab", { name: "Live", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(panel.getByRole("tab", { name: "Capture (0)", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(loadingTab).toBeFocused();
    await state.selectOption("loading");
    await info.attach(`Loading running ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test(`Loading timings and comparisons preserve measured and missing data in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto("/checks/loading.html");
    const review = page.getByRole("region", { name: `Loading review ${theme}`, exact: true });
    const panel = review.getByRole("region", { name: "Live performance panel" });
    const body = panel.getByRole("tabpanel", { name: /^Loading/ });
    const state = review.getByLabel("Reference state");
    const waterfall = body.getByRole("region", { name: "Stages waterfall" });
    const summary = body.locator('dl[aria-label="Loading summary"]');
    await expect(summary).toContainText("Cold run412 ms");
    await expect(summary).toContainText("Cache hits10%2 / 20");
    await expect(waterfall.locator("[data-loading-cold]")).toHaveCount(2);
    await expect(waterfall.locator("[data-loading-running]")).toHaveCount(1);
    await expect(waterfall).toContainText("160 ms active wall · 8 ops · 720 ms op time");
    const textures = waterfall.getByRole("img", { name: /^textures,/ });
    const sizes = await textures.evaluate((el) => ({
      track: el.clientWidth,
      warm: el.querySelector("[data-loading-ended]")?.getBoundingClientRect().width ?? 0,
      cold: el.querySelector("[data-loading-cold]")?.getBoundingClientRect().width ?? 0,
    }));
    expect(sizes.warm / sizes.track).toBeCloseTo(160 / 500, 2);
    expect(sizes.cold / sizes.track).toBeCloseTo(320 / 500, 2);
    const marker = waterfall.locator("[data-loading-cutoff]").first();
    expect(await marker.evaluate((el) => (el as HTMLElement).style.left)).toBe("56%");
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await review.getByRole("button", { name: "Advance host snapshot" }).click();
    expect(await marker.evaluate((el) => (el as HTMLElement).style.left)).toBe("56%");
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    expect(await marker.evaluate((el) => (el as HTMLElement).style.left)).toBe("76%");
    await state.selectOption("ready");
    await expect(summary).toContainText("vs cold−116 ms");
    await expect(summary).toContainText("−28% of 412 ms");
    const cache = body.getByRole("region", { name: "Loading cache" });
    await expect(cache.getByRole("row", { name: /textures/ })).toContainText("8 MiB");
    await expect(cache.getByRole("row", { name: /pipelines/ })).toContainText("0 B");
    await waterfall.scrollIntoViewIfNeeded();
    await info.attach(`Loading waterfall ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    await cache.scrollIntoViewIfNeeded();
    await info.attach(`Loading cache ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    const height = await body.evaluate((el) => el.getBoundingClientRect().height);
    await state.selectOption("missing");
    await expect(
      waterfall.locator("[data-loading-ended], [data-loading-running], [data-loading-cold]"),
    ).toHaveCount(0);
    await expect(waterfall).toContainText("Timing unavailable for 8 of 8 operations");
    await expect(waterfall).toContainText("160 ms active wall");
    await expect(summary).toContainText("Cache hitsUnknown");
    await expect(cache.getByRole("img", { name: "Not reported", exact: true })).toHaveCount(8);
    await state.selectOption("partial");
    await expect(waterfall).toContainText("Timing unavailable for 4 of 8 operations");
    await expect(waterfall).toContainText("Unknown active wall");
    await expect(summary).toContainText("Cache hitsUnknown");
    await state.selectOption("unmatched");
    await expect(summary).toContainText("no matching run");
    await expect(waterfall.locator("[data-loading-cold]")).toHaveCount(0);
    await state.selectOption("unknown");
    await expect(waterfall.locator("[data-loading-cutoff]")).toHaveCount(0);
    await expect(waterfall.locator("[data-loading-ended]")).toHaveCount(2);
    await state.selectOption("failed");
    await expect(waterfall.locator("[data-loading-failure]")).toHaveCount(2);
    await expect(waterfall).toContainText("Failed at 160 ms");
    await expect(waterfall).toContainText("Failed at 280 ms");
    await expect(summary).toContainText("Failed ops2 / 20");
    expect(await body.evaluate((el) => el.getBoundingClientRect().height)).toBe(height);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test("loading stays independent of capture, Freeze and compact display modes", async ({
  page,
}, info) => {
  await page.goto("/checks/loading.html");
  const review = page.getByRole("region", { name: "Loading review dark", exact: true });
  const panel = review.getByRole("region", { name: "Live performance panel" });
  await panel.getByRole("button", { name: "Freeze", exact: true }).click();
  const held = await panel.getAttribute("data-frame");
  await panel.getByRole("button", { name: "Rec", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Stop and save", exact: true })).toBeVisible();
  await expect(panel.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
  await review.getByRole("button", { name: "Advance host snapshot" }).click();
  await expect(panel).toHaveAttribute("data-frame", held ?? "");
  await review.getByLabel("Reference state").selectOption("ready");
  await expect(panel.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("status", { name: "Recording", exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "Loading", exact: true }).click();
  const body = panel.getByRole("tabpanel", { name: /^Loading/ });
  await expect(body).toContainText("Showing a frozen loading snapshot");
  await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("280 ms");
  await panel.getByRole("button", { name: "Freeze", exact: true }).click();
  await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText("296 ms");
  await review.getByLabel("Reference state").selectOption("loading");
  await panel.getByRole("button", { name: "Freeze", exact: true }).click();
  for (const mode of ["full", "mini", "line"] as const) {
    if (mode !== "full")
      await panel
        .getByRole("button", { name: mode === "mini" ? "Mini view" : "Line view", exact: true })
        .click();
    await expect(panel).toHaveAttribute("data-mode", mode);
    const header = panel.locator(`[data-mode-header="${mode}"]:visible`);
    for (const name of ["Collecting", "Display frozen", "Recording", "Loading"])
      await expect(header.getByRole("status", { name, exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        header.locator("[data-state-strip]").evaluate((el) => {
          const available = el.getBoundingClientRect();
          const badges = el.querySelector("[data-state-badges]")?.getBoundingClientRect();
          return !!badges && badges.right <= available.right + 1;
        }),
      )
      .toBe(true);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await info.attach(`Loading and recording ${mode}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
  }
  await panel.getByRole("button", { name: /^Expand to full panel/ }).click();
  await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
  await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Capture (1)", exact: true })).toBeVisible();
  await expect(panel.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
});
