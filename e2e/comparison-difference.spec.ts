import { expect, test } from "@playwright/test";
import { comparisonFixture } from "../src/compare/fixtures.ts";

for (const theme of ["dark", "light"]) {
  test(`signed differences and visibility preserve time, scales and results in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1920, height: 1200 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/viewer.html?comparison=mixed&theme=${theme}`);
    const pane = page.locator("[data-comparison-graph-pane]");
    const delta = page.locator('[data-comparison-difference="Frame time"]');
    const track = delta.getByRole("slider");
    const readout = delta.locator("[data-comparison-difference-readout]");
    const path = delta.locator("[data-comparison-difference-series]");
    const a = page.getByRole("button", { name: "variant A", exact: true });
    const b = page.getByRole("button", { name: "variant B", exact: true });
    const summary = page.getByRole("region", { name: "Comparison summary" });
    const results = await summary.textContent();
    await expect(readout).toHaveText("+2.00 ms");
    const cpu = page.getByRole("region", { name: "Comparison CPU scopes" });
    await expect(cpu.locator("[data-comparison-difference-readout]").first()).toHaveText(
      "+2.00 ms",
    );
    const originalPath = await path.getAttribute("d");
    const originalA = await page.locator('[data-comparison-series="A"]').getAttribute("d");
    const originalB = await page.locator('[data-comparison-series="B"]').getAttribute("d");
    await track.press("PageUp");
    const time = await track.getAttribute("aria-valuenow");
    await a.click();
    await expect(a).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator(
        '[data-comparison-series="A"], [data-comparison-lane-series="A"], [data-comparison-lane-missing="A"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator('[data-comparison-series="B"]')).toHaveAttribute(
      "d",
      originalB ?? "",
    );
    await b.focus();
    await b.press("Enter");
    await expect(b).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator("[data-comparison-series], [data-comparison-lane-series]"),
    ).toHaveCount(0);
    await expect(page.locator('[data-comparison-readout="A"]')).toContainText("hidden");
    await expect(page.locator('[data-comparison-readout="B"]')).toContainText("hidden");
    await expect(path).toHaveAttribute("d", originalPath ?? "");
    expect(await summary.textContent()).toBe(results);
    for (const slider of await pane.locator("[data-comparison-track]").all())
      await expect(slider).toHaveAttribute("aria-valuenow", time ?? "");
    await a.click();
    await b.click();
    await expect(page.locator('[data-comparison-series="A"]')).toHaveAttribute(
      "d",
      originalA ?? "",
    );
    await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    await expect(readout).toHaveText("−2.00 ms");
    expect(await summary.textContent()).toBe(results);
    await delta.scrollIntoViewIfNeeded();
    await info.attach(`Comparison difference ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-difference-${theme}.png` }),
      contentType: "image/png",
    });
    for (const size of [
      { width: 1024, height: 480 },
      { width: 1920, height: 963 },
    ]) {
      await page.setViewportSize(size);
      expect(await pane.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      expect(
        await page.evaluate(
          () => document.scrollingElement?.scrollHeight === document.scrollingElement?.clientHeight,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("known zero, missing GPU, partial CPU and unrecorded trials remain distinct in differences", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?comparison=same");
  const frame = page.locator('[data-comparison-difference="Frame time"]');
  await expect(frame.locator("[data-comparison-difference-readout]")).toHaveText("0.00 ms");
  await expect(frame.locator("[data-comparison-difference-series]")).toHaveAttribute(
    "d",
    /^M0,50H/,
  );
  await page.goto("/checks/viewer.html?comparison=gpu-gap");
  const gpu = page.getByRole("region", { name: "Comparison GPU passes" });
  const delta = gpu.locator("[data-comparison-difference]").first();
  const track = delta.getByRole("slider");
  await track.press("Home");
  for (let step = 0; step < 8; step++) await track.press("PageUp");
  await expect(delta.locator("[data-comparison-difference-readout]")).toHaveText("unavailable");
  await expect(delta.locator("[data-comparison-difference-missing]")).not.toHaveAttribute("d", "");
  await expect(track).toHaveAttribute("aria-valuetext", /No GPU record linked/);
  await page.goto("/checks/viewer.html?comparison=mixed&lane-states");
  const cpu = page
    .getByRole("region", { name: "Comparison CPU scopes" })
    .locator("[data-comparison-difference]")
    .first();
  for (let step = 0; step < 25; step++) await cpu.getByRole("slider").press("ArrowRight");
  await expect(cpu.locator("[data-comparison-difference-readout]")).toHaveText("unavailable");
  await expect(cpu.getByRole("slider")).toHaveAttribute(
    "aria-valuetext",
    /CPU coverage is incomplete/,
  );
  await page.goto("/checks/viewer.html?comparison=stopped");
  await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  await expect(frame.locator("[data-comparison-difference-readout]")).toHaveText("unavailable");
  await expect(frame.locator("[data-comparison-difference-series]")).toHaveAttribute("d", "");
  await expect(frame.getByText("Range unavailable")).toBeVisible();
});

test("visibility survives pair selection and rejected imports, then resets for a replacement", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?comparison=mixed");
  const b = page.getByRole("button", { name: "variant B", exact: true });
  await b.click();
  await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  await expect(b).toHaveAttribute("aria-pressed", "false");
  const input = page.getByLabel("Open recording or comparison file");
  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(b).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("radio", { name: "Pair 2 · B then A" })).toBeChecked();
  await input.setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonFixture("same"))),
  });
  await expect(b).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: "Pair 1 · A then B" })).toBeChecked();
});
