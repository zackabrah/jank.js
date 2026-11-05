import { expect, test } from "@playwright/test";
import { comparisonFixture } from "../src/compare/fixtures.ts";

for (const theme of ["dark", "light"]) {
  test(`overview range drives every comparison track in ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/viewer.html?comparison=mixed&spikes&lane-states&theme=${theme}`);
    const start = page.getByRole("slider", { name: "Visible time start", exact: true });
    const end = page.getByRole("slider", { name: "Visible time end", exact: true });
    const main = page.getByRole("slider", { name: "Comparison elapsed time", exact: true });
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    const fit = page.getByRole("button", { name: "Fit", exact: true });
    const summary = page.getByRole("region", { name: "Comparison summary" });
    const results = await summary.textContent();
    const series = page.locator('[data-comparison-series="A"]');
    const path = await series.getAttribute("d");
    const bounds = await page.locator("[data-comparison-brush]").boundingBox();
    if (!bounds) throw new Error("Missing overview");
    const duration = Number(await end.getAttribute("aria-valuemax"));
    // Firefox delivers no mouse events past the viewport edge, so stay just inside it.
    const x = (share: number) => Math.min(bounds.x + bounds.width * share, 1439);
    const y = bounds.y + 30;
    const pixel = (1.5 * duration) / bounds.width;
    const range = async () => ({
      start: Number(await start.getAttribute("aria-valuenow")),
      end: Number(await end.getAttribute("aria-valuenow")),
    });
    const near = async (first: number, last: number, tolerance = pixel) => {
      const now = await range();
      expect(Math.abs(now.start - first * duration)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(now.end - last * duration)).toBeLessThanOrEqual(tolerance);
    };
    // Handles keep the grab offset instead of jumping to the pointer: within a 12px grip.
    const grip = (12 * duration) / bounds.width;
    const drag = async (from: number, to: number) => {
      await page.mouse.move(x(from), y);
      await page.mouse.down();
      await page.mouse.move(x(to), y, { steps: 4 });
      await page.mouse.up();
    };
    /** Every track must expose one range and cursor, and every plot the same window. */
    const expectShared = async () => {
      const now = await range();
      const shared = await page.locator("[data-comparison-graph-pane]").evaluate((pane) => ({
        tracks: [
          ...new Set(
            [...pane.querySelectorAll("[data-comparison-track]")].map((track) =>
              ["aria-valuemin", "aria-valuemax", "aria-valuenow"]
                .map((name) => track.getAttribute(name))
                .join(" "),
            ),
          ),
        ],
        windows: [
          ...new Set(
            [...pane.querySelectorAll("[data-comparison-window]")].map((plot) =>
              plot.getAttribute("viewBox"),
            ),
          ),
        ],
      }));
      expect(shared.tracks).toHaveLength(1);
      expect(shared.windows).toHaveLength(1);
      const [min, max, cursor] = (shared.tracks[0] ?? "").split(" ").map(Number);
      expect(min).toBe(now.start);
      expect(max).toBe(now.end);
      expect(cursor).toBeGreaterThanOrEqual(now.start);
      expect(cursor).toBeLessThanOrEqual(now.end);
      const [left, , width] = (shared.windows[0] ?? "").split(" ").map(Number);
      expect(left).toBeCloseTo((now.start / duration) * 100, 6);
      expect(width).toBeCloseTo(((now.end - now.start) / duration) * 100, 6);
    };

    expect(await range()).toEqual({ start: 0, end: duration });
    await expectShared();
    // At full width a drag has nothing to pan.
    await drag(0.3, 0.5);
    expect(await range()).toEqual({ start: 0, end: duration });

    await zoomIn.click();
    await near(0, 0.5);
    await expectShared();
    await expect(page.locator("[data-comparison-range-readout]")).toContainText(
      `0.000 s–${(duration / 2000).toFixed(3)} s`,
    );

    // Panning preserves width and clamps; a cursor it excludes moves to the near edge.
    await main.press("End");
    const cursor = await main.getAttribute("aria-valuenow");
    await drag(0.25, 0.35);
    await near(0.1, 0.6);
    await expect(main).toHaveAttribute("aria-valuenow", cursor ?? "");
    await drag(0.25, 2);
    await near(0.5, 1);
    await expect(main).toHaveAttribute("aria-valuenow", String((await range()).start));
    await expectShared();

    // A click outside the window changes nothing, whichever pointer path it takes.
    const before = await range();
    await drag(0.2, 0.2);
    expect(await range()).toEqual(before);

    // Escape restores the original range mid-brush and the release cannot reapply it.
    await page.mouse.move(x(0.2), y);
    await page.mouse.down();
    await page.mouse.move(x(0.1), y, { steps: 2 });
    await near(0.1, 0.2);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await range()).toEqual(before);
    await expect(page.locator("[data-comparison-view]")).toBeVisible();

    await drag(0.4, 0.2);
    await near(0.2, 0.4);
    await expectShared();

    // Handles resize one edge; the other stays put, even when dragged past it.
    const held = (await range()).end;
    await start.locator("circle").first().hover();
    await page.mouse.down();
    await page.mouse.move(x(0.1), y, { steps: 2 });
    await page.mouse.up();
    await near(0.1, 0.4, grip);
    expect((await range()).end).toBe(held);
    await end.locator("circle").first().hover();
    await page.mouse.down();
    await page.mouse.move(x(0.6), y, { steps: 2 });
    await page.mouse.up();
    await near(0.1, 0.6, grip);
    const edge = (await range()).end;
    await start.locator("circle").first().hover();
    await page.mouse.down();
    await page.mouse.move(x(0.95), y, { steps: 2 });
    await page.mouse.up();
    expect((await range()).end).toBe(edge);
    expect((await range()).start).toBeLessThan(edge);
    await expectShared();

    // Keyboard reaches both edges without either crossing the other.
    await start.focus();
    await start.press("Home");
    expect((await range()).start).toBe(0);
    await end.focus();
    await end.press("End");
    expect((await range()).end).toBe(duration);
    await end.press("ArrowLeft");
    expect((await range()).end).toBeCloseTo(duration - Math.max(1, duration / 1000), 6);
    await end.press("Home");
    expect((await range()).end).toBeGreaterThan(0);
    await fit.click();
    expect(await range()).toEqual({ start: 0, end: duration });

    // Track input maps through the window, and the cursor keeps zoom anchored.
    await zoomIn.click();
    await drag(0.25, 0.5);
    const now = await range();
    const box = await main.boundingBox();
    if (!box) throw new Error("Missing track");
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    const at = Number(await main.getAttribute("aria-valuenow"));
    expect(at - now.start).toBeLessThan(((now.end - now.start) * 2) / box.width);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const middle = (now.start + now.end) / 2;
    expect(Number(await main.getAttribute("aria-valuenow"))).toBeCloseTo(middle, 0);
    await main.press("Home");
    await expect(main).toHaveAttribute("aria-valuenow", String(now.start));
    await main.press("End");
    await expect(main).toHaveAttribute("aria-valuenow", String(now.end));

    // Deep zoom keeps the round/square encoding on screen and leaves data and results alone.
    for (let i = 0; i < 3; i++) await zoomIn.click();
    await expect(page.locator('[data-comparison-marker="A"]').first()).toBeVisible();
    await expect(page.locator('[data-comparison-marker="B"]').first()).toBeVisible();
    await expectShared();
    await expect(series).toHaveAttribute("d", path ?? "");
    expect(await summary.textContent()).toBe(results);
    await info.attach(`Comparison range ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-range-${theme}.png` }),
      contentType: "image/png",
    });

    for (const viewport of [
      { width: 1024, height: 480 },
      { width: 1920, height: 963 },
    ]) {
      await page.setViewportSize(viewport);
      const pane = page.locator("[data-comparison-graph-pane]");
      expect(await pane.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("range resets with its pair and replacement file but survives a rejected import", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?comparison=mixed&spikes");
  const end = page.getByRole("slider", { name: "Visible time end", exact: true });
  const full = await end.getAttribute("aria-valuenow");
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  await zoomIn.click();
  await expect(end).not.toHaveAttribute("aria-valuenow", full ?? "");
  const input = page.getByLabel("Open recording or comparison file");
  const zoomed = await end.getAttribute("aria-valuenow");
  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(end).toHaveAttribute("aria-valuenow", zoomed ?? "");
  const pair = page.getByRole("radio", { name: "Pair 2 · B then A" });
  await pair.check();
  await expect(end).toHaveAttribute(
    "aria-valuenow",
    (await end.getAttribute("aria-valuemax")) ?? "",
  );
  await zoomIn.click();
  await expect(end).not.toHaveAttribute(
    "aria-valuenow",
    (await end.getAttribute("aria-valuemax")) ?? "",
  );
  await input.setInputFiles({
    name: "new.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonFixture("same"))),
  });
  await expect(page.getByRole("radio", { name: "Pair 1 · A then B" })).toBeChecked();
  await expect(page.locator("[data-comparison-range-readout]")).toContainText("0.000 s–");
  expect(await end.getAttribute("aria-valuenow")).toBe(await end.getAttribute("aria-valuemax"));
});
