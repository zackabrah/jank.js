import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { comparisonFixture } from "../src/compare/fixtures.ts";
import { parseComparison } from "../src/compare/model.ts";
import { recordingFixture } from "../src/recording/fixtures.ts";

for (const theme of ["dark", "light"]) {
  test(`comparison verdicts, failed trial links, settings and contained scrolling in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/viewer.html?comparison=gpu-gap&theme=${theme}`);
    const viewer = page.locator("#viewer");
    const body = viewer.locator("[data-comparison-view]");
    const gpu = viewer.getByRole("article", { name: "GPU verdict" });
    await expect(gpu).toContainText("Unknown");
    await expect(gpu).toContainText("80% is required");
    await expect(viewer.getByRole("region", { name: "Comparison metric results" })).toBeVisible();
    expect(await body.evaluate((node) => node.scrollTop)).toBe(0);
    await info.attach(`Comparison viewer ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-viewer-${theme}.png` }),
      contentType: "image/png",
    });
    await viewer.getByRole("button", { name: "Show settings" }).click();
    const settings = viewer.getByRole("tab", { name: "Settings, 1 other difference", exact: true });
    await expect(settings).toBeFocused();
    await expect(settings).toHaveAttribute("aria-selected", "true");
    await expect(viewer.getByRole("table", { name: "Variant settings" })).toContainText(
      "≠ objects",
    );
    await expect(viewer.getByRole("cell", { name: "128", exact: true })).toBeVisible();
    await settings.press("Home");
    await expect(viewer.getByRole("tab", { name: "Results", exact: true })).toBeFocused();
    await expect(viewer.getByRole("region", { name: "Comparison settings" })).toHaveCount(0);
    for (let attempt = 0; attempt < 2; attempt++) {
      await gpu.getByRole("button", { name: "View trial" }).click();
      const row = viewer.getByRole("listitem", { name: "Trial 1B", exact: true });
      await expect(row).toBeFocused();
      await expect(row).toContainText("80% is required");
      await expect(
        viewer.getByRole("tab", { name: /Trials, 1 trial with failed requirements/ }),
      ).toHaveAttribute("aria-selected", "true");
    }
    await info.attach(`Failed trial ${theme}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    for (const viewport of [
      { width: 1920, height: 963 },
      { width: 1024, height: 480 },
      { width: 1440, height: 1140 },
    ]) {
      await page.setViewportSize(viewport);
      for (const tab of ["Results", "Trials", "Settings", "Frame"]) {
        await viewer.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        const layout = await body.evaluate((element) => {
          const host = (element.getRootNode() as ShadowRoot).host;
          const page = element.ownerDocument.scrollingElement;
          const footer = element.parentElement?.querySelector("footer");
          if (!page || !footer) throw new Error("Missing comparison layout");
          page.scrollTop = page.scrollHeight;
          element.scrollTop = element.scrollHeight;
          return {
            overflow: host.scrollHeight - host.clientHeight,
            horizontal: host.scrollWidth - host.clientWidth,
            pageScroll: page.scrollTop,
            pageOverflow: page.scrollHeight - page.clientHeight,
            footerBottom: footer.getBoundingClientRect().bottom,
            scroll: element.scrollTop,
            maximum: element.scrollHeight - element.clientHeight,
          };
        });
        expect(layout.overflow).toBe(0);
        expect(layout.horizontal).toBe(0);
        expect(layout.pageScroll).toBe(0);
        expect(layout.pageOverflow).toBe(0);
        expect(layout.footerBottom).toBe(viewport.height);
        expect(Math.abs(layout.scroll - layout.maximum)).toBeLessThanOrEqual(1);
      }
      for (const pane of [
        viewer.locator("[data-comparison-graph-pane]"),
        viewer.getByRole("complementary", { name: "Comparison inspector" }),
      ]) {
        const bounds = await pane.boundingBox();
        expect(bounds?.height).toBeGreaterThan(0);
        const limits = await pane.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
          return {
            at: node.scrollTop,
            end: node.scrollHeight - node.clientHeight,
            horizontal: node.scrollWidth - node.clientWidth,
          };
        });
        expect(Math.abs(limits.at - limits.end)).toBeLessThanOrEqual(1);
        expect(limits.horizontal).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });
}

for (const theme of ["dark", "light"]) {
  test(`pair order, shared time cursor and frame graph in ${theme}`, async ({ page }, info) => {
    await page.goto(`/checks/viewer.html?comparison=mixed&theme=${theme}`);
    const first = page.getByRole("radio", { name: "Pair 1 · A then B" });
    const second = page.getByRole("radio", { name: "Pair 2 · B then A" });
    const graph = page.getByRole("slider", { name: "Comparison elapsed time" });
    const a = page.locator('[data-comparison-readout="A"]');
    const b = page.locator('[data-comparison-readout="B"]');
    await expect(first).toBeChecked();
    await expect(a).toContainText("20.0 ms");
    await expect(b).toContainText("22.0 ms");
    await expect(graph).toHaveAttribute("aria-valuemax", "1012");
    await expect(page.locator('[data-comparison-series="B"]')).toHaveAttribute(
      "stroke-dasharray",
      "5 4",
    );
    await expect(page.locator("[data-axis-break]")).toBeVisible();
    await graph.press("End");
    await expect(graph).toHaveAttribute("aria-valuenow", "1012");
    await expect(a).toContainText("No recorded frame at this time");
    await expect(b).toContainText("22.0 ms");
    await first.focus();
    await first.press("ArrowRight");
    await expect(second).toBeChecked();
    await expect(graph).toHaveAttribute("aria-valuenow", "0");
    await expect(b).toContainText("18.0 ms");
    const bounds = await graph.boundingBox();
    if (!bounds) throw new Error("Missing frame graph");
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + 80);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + 80);
    await page.mouse.up();
    const elapsed = Number(await graph.getAttribute("aria-valuenow"));
    expect(elapsed).toBeGreaterThan(690);
    expect(elapsed).toBeLessThan(720);
    const height = (await page.getByRole("region", { name: "Aligned frame times" }).boundingBox())
      ?.height;
    await graph.press("Home");
    await graph.press("ArrowRight");
    expect(Number(await graph.getAttribute("aria-valuenow"))).toBeCloseTo(1.008);
    expect(
      (await page.getByRole("region", { name: "Aligned frame times" }).boundingBox())?.height,
    ).toBe(height);
    await page.goto(`/checks/viewer.html?comparison=mixed&spikes&theme=${theme}`);
    await expect(graph).toBeVisible();
    await info.attach(`Aligned frame graph ${theme}`, {
      body: await page.screenshot({ path: `test-results/comparison-graph-${theme}.png` }),
      contentType: "image/png",
    });
  });
}

test("overlapping, missing and partial frame series remain explicit", async ({ page }) => {
  await page.goto("/checks/viewer.html?comparison=same");
  const graph = page.getByRole("slider", { name: "Comparison elapsed time" });
  await expect(page.locator('[data-comparison-series="A"]')).toHaveAttribute(
    "d",
    (await page.locator('[data-comparison-series="B"]').getAttribute("d")) ?? "",
  );
  for (const key of ["A", "B"])
    await expect(page.locator(`[data-comparison-readout="${key}"]`)).toContainText("20.0 ms");
  await page.goto("/checks/viewer.html?comparison=low-window");
  await graph.focus();
  for (let step = 0; step < 25; step++) await graph.press("ArrowRight");
  await expect(page.locator('[data-comparison-readout="A"]')).toContainText(
    "No recorded frame at this time",
  );
  await expect(page.locator('[data-comparison-series="A"]')).toHaveAttribute("d", /M.*M/);
  await page.goto("/checks/viewer.html?comparison=stopped");
  await page.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  await expect(page.locator('[data-comparison-series="A"]')).toHaveAttribute("d", "");
  await expect(page.locator('[data-comparison-readout="A"]')).toContainText(
    "Trial 2A was not completed",
  );
  await expect(page.locator('[data-comparison-readout="B"]')).toContainText("18.0 ms");
});

for (const surface of ["standalone", "dialog"] as const) {
  test(`${surface} viewer round-trips a partial comparison and retains it after a rejected import`, async ({
    page,
  }) => {
    if (surface === "standalone") await page.goto("/viewer.html");
    else {
      await page.goto("/checks/capture.html");
      const panel = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Idle · dark", exact: true }) });
      await panel.getByRole("button", { name: "Start recording", exact: true }).click();
      await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
      await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
      await panel
        .getByRole("status", { name: "Capture C1 saved", exact: true })
        .getByRole("button", { name: "Open", exact: true })
        .click();
    }
    const viewer = surface === "standalone" ? page.locator("#viewer") : page.getByRole("dialog");
    const input = viewer.getByLabel("Open recording or comparison file");
    const bundle = comparisonFixture("stopped");
    await input.setInputFiles({
      name: "partial.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(
      viewer.getByRole("heading", { name: "Comparison viewer", exact: true }),
    ).toBeVisible();
    await expect(viewer.getByText(/Comparison stopped/)).toBeVisible();
    await viewer
      .getByRole("article", { name: "CPU verdict" })
      .getByRole("button", { name: "View trial" })
      .click();
    const row = viewer.getByRole("listitem", { name: "Trial 2A", exact: true });
    await expect(row).toBeFocused();
    await expect(viewer.getByRole("radio", { name: "Pair 2 · B then A" })).toBeChecked();
    await expect(row).toContainText("Not completed");
    await input.setInputFiles({
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...bundle, version: 2 })),
    });
    await expect(viewer.getByRole("alert")).toContainText(
      "current comparison is still open: partial.json",
    );
    await expect(row).toBeVisible();
    await expect(viewer.getByRole("radio", { name: "Pair 2 · B then A" })).toBeChecked();
    await viewer.getByRole("alert").getByRole("button", { name: "Dismiss notice" }).click();
    await expect(viewer.getByRole("button", { name: "Open file…" })).toBeFocused();
    const downloading = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("partial.json");
    const path = await download.path();
    if (!path) throw new Error("Missing comparison export");
    expect(parseComparison(await readFile(path, "utf8"))).toEqual(bundle);
    await input.setInputFiles(path);
    await expect(viewer.getByRole("radio", { name: "Pair 1 · A then B" })).toBeChecked();
    await expect(viewer.getByRole("tab", { name: "Results", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await input.setInputFiles({
      name: "recording.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recordingFixture())),
    });
    await expect(
      viewer.getByRole("heading", { name: "Recording viewer", exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole("heading", { name: /^Frame f/ })).toBeVisible();
    if (surface === "dialog") {
      await viewer.getByRole("button", { name: "Close viewer" }).click();
      await expect(viewer).toHaveCount(0);
    }
  });
}
