import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`paired frame inspector follows the shared cursor in ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1140 });
    await page.goto(`/checks/viewer.html?comparison=mixed&spikes&theme=${theme}`);
    const frameTab = page.getByRole("tab", { name: "Frame", exact: true });
    const main = page.getByRole("slider", { name: "Comparison elapsed time", exact: true });
    const paired = page.getByRole("region", { name: "Paired frames" });
    const heading = paired.getByRole("heading", { level: 2 }).first();
    const a = paired.locator('[data-comparison-frame-variant="A"]');
    const b = paired.locator('[data-comparison-frame-variant="B"]');
    const headingAt = (at: number) => `Frame at ${(at / 1000).toFixed(3)} s`;
    const results = page.getByRole("tab", { name: "Results", exact: true });
    await results.focus();
    await results.press("End");
    await expect(frameTab).toBeFocused();
    await expect(frameTab).toHaveAttribute("aria-selected", "true");
    await expect(heading).toHaveText(headingAt(0));

    // A click selects; the inspector, graph readouts and B − A lane read the same frames.
    const box = await main.boundingBox();
    if (!box) throw new Error("Missing frame graph");
    const y = box.y + 40;
    await page.mouse.click(box.x + box.width * 0.75, y);
    const selected = (await main.getAttribute("aria-valuenow")) ?? "";
    await expect(heading).toHaveText(headingAt(Number(selected)));
    for (const [key, side] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const id = /f\d+/.exec((await side.textContent()) ?? "")?.[0] ?? "";
      expect(id).not.toBe("");
      await expect(page.locator(`[data-comparison-readout="${key}"]`)).toContainText(id);
    }
    const lane = page.locator('[data-comparison-difference="Frame time"]');
    const signed = (await lane.locator("[data-comparison-difference-readout]").textContent()) ?? "";
    await expect(paired.locator("[data-comparison-frame-delta]")).toHaveText(`B − A ${signed}`);

    // Hover previews in both panes; leaving returns to the selection, however far the mouse went.
    await page.mouse.move(box.x + box.width * 0.25, y);
    const preview = Number(await main.getAttribute("aria-valuenow"));
    expect(preview).toBeLessThan(Number(selected));
    await expect(heading).toHaveText(headingAt(preview));
    const inspector = await page
      .getByRole("complementary", { name: "Comparison inspector" })
      .boundingBox();
    if (!inspector) throw new Error("Missing inspector");
    await page.mouse.move(inspector.x + 100, y, { steps: 8 });
    await expect(main).toHaveAttribute("aria-valuenow", selected);
    await expect(heading).toHaveText(headingAt(Number(selected)));
    for (const track of await page.locator("[data-comparison-track]").all())
      await expect(track).toHaveAttribute("aria-valuenow", selected);

    // Keys win over a parked mouse, and zoom keeps the selection rather than the preview.
    await page.mouse.move(box.x + box.width * 0.5, y);
    await main.press("Home");
    await expect(main).toHaveAttribute("aria-valuenow", "0");
    await expect(heading).toHaveText(headingAt(0));
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(heading).toHaveText(headingAt(0));

    // Series visibility hides plots, not the evidence for the selected frames.
    await page.getByRole("button", { name: "variant A", exact: true }).click();
    await expect(page.locator('[data-comparison-readout="A"]')).toContainText("hidden");
    await expect(a).toContainText("f");
    await page.getByRole("button", { name: "variant A", exact: true }).click();

    // Paired values for the comparison, then each frame's full evidence on request.
    const cpu = paired.getByRole("region", { name: "Paired CPU scopes" });
    await expect(cpu.getByRole("row", { name: /physics/ })).toContainText("+2.00");
    const hiddenDetails = paired.getByRole("region", { name: "Variant A frame details" });
    await expect(hiddenDetails).toBeHidden();
    await paired.getByRole("button", { name: /^Variant A/ }).click();
    await expect(hiddenDetails).toBeVisible();
    await expect(hiddenDetails).toContainText("on this trial's clock");
    await expect(paired.getByRole("region", { name: "Variant B frame details" })).toBeHidden();
    await expect(hiddenDetails.getByRole("button", { name: /^Pin / })).toHaveCount(0);
    await hiddenDetails.getByRole("button", { name: "Copy frame JSON" }).click();
    await expect(hiddenDetails.getByRole("status")).toHaveText(/copied|Clipboard unavailable/);

    // Details stay open as the cursor moves; a new pair keeps the tab and resets the cursor.
    await main.press("End");
    await expect(hiddenDetails).toBeVisible();
    await info.attach(`Paired frame ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-frame-${theme}.png` }),
      contentType: "image/png",
    });
    await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
    await expect(frameTab).toHaveAttribute("aria-selected", "true");
    await expect(main).toHaveAttribute("aria-valuenow", "0");
    await expect(heading).toHaveText(headingAt(0));
    expect(errors).toEqual([]);
  });
}

test("unavailable evidence stays distinct and never becomes a difference", async ({ page }) => {
  await page.goto("/checks/viewer.html?comparison=mixed&lane-states");
  await page.getByRole("tab", { name: "Frame", exact: true }).click();
  const paired = page.getByRole("region", { name: "Paired frames" });
  const gpu = paired.getByRole("region", { name: "Paired GPU passes" }).locator("tbody tr").first();
  const track = page.getByRole("slider", { name: "Comparison elapsed time", exact: true });
  const cells = gpu.locator("td");
  await track.press("Home");
  await expect(cells.first()).toHaveText("0.00");
  await expect(cells.last()).not.toHaveText("—");
  for (const [steps, status] of [
    [25, "missing"],
    [25, "pending"],
    [25, "rejected"],
    [15, "unknown"],
  ] as const) {
    for (let i = 0; i < steps; i++) await track.press("ArrowRight");
    await expect(cells.first()).toContainText(status);
    await expect(cells.last()).toHaveText("—");
  }
  // Both frames have complete inventories without this pass, so neither has anything to compare.
  for (let i = 0; i < 20; i++) await track.press("ArrowRight");
  await expect(gpu).toHaveCount(0);
  await expect(paired).toContainText("No GPU passes timed in these frames.");
  await track.press("Home");
  for (let i = 0; i < 25; i++) await track.press("ArrowRight");
  const cpu = paired.getByRole("region", { name: "Paired CPU scopes" });
  await expect(cpu.locator("tbody tr").first().locator("td").first()).toContainText("*");
  await expect(cpu.locator("tbody tr").first().locator("td").last()).toHaveText("—");
});

test("an incomplete pair names the missing trial and offers no details for it", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?comparison=stopped");
  await page.getByRole("tab", { name: "Frame", exact: true }).click();
  await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  const paired = page.getByRole("region", { name: "Paired frames" });
  const a = paired.locator('[data-comparison-frame-variant="A"]');
  await expect(a).toContainText("Trial 2A was not completed.");
  await expect(paired.locator("[data-comparison-frame-delta]")).toHaveCount(0);
  await expect(paired.getByRole("button", { name: /^Variant A/ })).toHaveCount(0);
  await expect(paired.getByRole("button", { name: /^Variant B/ })).toHaveCount(1);
});
