import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`comparison lanes share the cursor and preserve missing GPU and sample age in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1920, height: 1200 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/viewer.html?comparison=gpu-gap&theme=${theme}`);
    const pane = page.locator("[data-comparison-graph-pane]");
    const gpu = page.getByRole("region", { name: "Comparison GPU passes" });
    const track = gpu.getByRole("slider").first();
    await track.press("Home");
    for (let step = 0; step < 8; step++) await track.press("PageUp");
    await expect(gpu.locator('[data-comparison-lane-readout="A"]')).toContainText("4.00 ms");
    await expect(gpu.locator('[data-comparison-lane-readout="B"]')).toContainText("missing");
    await expect(gpu.locator('[data-comparison-lane-missing="B"]')).not.toHaveAttribute("d", "");
    const time = await track.getAttribute("aria-valuenow");
    for (const slider of await pane.locator("[data-comparison-track]").all())
      await expect(slider).toHaveAttribute("aria-valuenow", time ?? "");
    const counters = page.getByRole("region", { name: "Comparison Counters" });
    const bodies = counters.locator("[data-comparison-lane]").first();
    await expect(bodies.locator('[data-comparison-lane-readout="B"]')).toContainText("22.0 ms old");
    await counters.scrollIntoViewIfNeeded();
    const bounds = await bodies.getByRole("slider").boundingBox();
    if (!bounds) throw new Error("Missing counter track");
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + 10);
    await page.mouse.up();
    const moved = Number(await track.getAttribute("aria-valuenow"));
    expect(moved).toBeGreaterThan(590);
    expect(moved).toBeLessThan(620);
    await track.press("Home");
    for (let step = 0; step < 8; step++) await track.press("PageUp");
    await pane.evaluate((node) => {
      node.scrollTop = 500;
    });
    await info.attach(`Comparison lanes ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-lanes-${theme}.png` }),
      contentType: "image/png",
    });
    await pane.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await info.attach(`Comparison counters ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-counters-${theme}.png` }),
      contentType: "image/png",
    });
    for (const viewport of [
      { width: 1024, height: 480 },
      { width: 1920, height: 963 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await pane.evaluate((node) => {
        const page = node.ownerDocument.scrollingElement;
        if (!page) throw new Error("Missing page");
        node.scrollTop = node.scrollHeight;
        page.scrollTop = page.scrollHeight;
        return {
          horizontal: node.scrollWidth - node.clientWidth,
          scroll: node.scrollTop,
          max: node.scrollHeight - node.clientHeight,
          page: page.scrollTop,
        };
      });
      expect(layout.horizontal).toBe(0);
      expect(layout.page).toBe(0);
      expect(Math.abs(layout.scroll - layout.max)).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}

test("GPU zero/pending/rejected/absent and partial CPU data stay distinct", async ({ page }) => {
  await page.goto("/checks/viewer.html?comparison=mixed&lane-states");
  const gpu = page.getByRole("region", { name: "Comparison GPU passes" });
  const track = gpu.getByRole("slider").first();
  const a = gpu.locator('[data-comparison-lane-readout="A"]');
  await track.press("Home");
  await expect(a).toContainText("0.00 ms");
  for (let i = 0; i < 25; i++) await track.press("ArrowRight");
  await expect(a).toContainText("missing");
  const cpu = page.getByRole("region", { name: "Comparison CPU scopes" });
  await expect(cpu.locator('[data-comparison-lane-readout="A"]').first()).toContainText("2.00 ms*");
  for (let i = 0; i < 25; i++) await track.press("ArrowRight");
  await expect(a).toContainText("pending");
  for (let i = 0; i < 25; i++) await track.press("ArrowRight");
  await expect(a).toContainText("rejected");
  for (let i = 0; i < 15; i++) await track.press("ArrowRight");
  await expect(a).toContainText("unknown");
  for (let i = 0; i < 20; i++) await track.press("ArrowRight");
  await expect(a).toContainText("absent");
});

test("long lane groups page without changing time and reset for a new pair", async ({ page }) => {
  await page.goto("/checks/viewer.html?comparison=mixed&many-lanes");
  const cpu = page.getByRole("region", { name: "Comparison CPU scopes" });
  await expect(cpu.locator("[data-comparison-lane]")).toHaveCount(16);
  await cpu.getByRole("slider").first().press("PageUp");
  const time = await page
    .getByRole("slider", { name: "Comparison elapsed time", exact: true })
    .getAttribute("aria-valuenow");
  await cpu.getByRole("button", { name: "Next lanes" }).click();
  await expect(cpu.getByText("17–32 of 32 lanes")).toBeVisible();
  await expect(cpu.getByRole("slider").first()).toHaveAttribute("aria-valuenow", time ?? "");
  await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  await expect(cpu.getByText("1–16 of 32 lanes")).toBeVisible();
  await expect(cpu.getByRole("slider").first()).toHaveAttribute("aria-valuenow", "0");
});
