import { expect } from "@playwright/test";

export async function captureViewer(page, take, samplePath) {
  await take("viewer-empty", "Viewer / empty");
  const open = async (name) => {
    await page.getByLabel("Open recording or comparison").setInputFiles(samplePath(name));
    await expect(page.locator("[data-viewer-recording]")).toBeVisible();
  };
  await open("mock-recording.json");
  await take("viewer-recording", "Viewer / recording overview");
  await page.locator("details[data-gpu-group]").evaluateAll((items) => {
    for (const item of items) {
      item.open = true;
    }
  });
  await take("viewer-gpu-expanded", "Viewer / GPU invocation groups expanded");
  const summaries = [
    "PIN COUNTERS",
    "VIEW",
    "NAVIGATION & MEASUREMENT NOTES",
    "CAPTURES",
    "FRAME DETAILS",
    "GPU coverage & timestamp evidence",
    "RECORDING & COVERAGE",
  ];
  for (const [index, title] of summaries.entries()) {
    const summary = page.getByText(title, { exact: true });
    await summary.evaluate((item) => {
      item.parentElement.open = true;
    });
    await summary.scrollIntoViewIfNeeded();
    await take(`viewer-disclosure-${index}`, `Viewer / ${title}`);
    if (title === "PIN COUNTERS") {
      await page.locator("[data-counter-pin-options] input").first().check();
      await take("viewer-counter-pinned", "Viewer / pinned counter lane");
    }
    await summary.evaluate((item) => {
      item.parentElement.open = false;
    });
  }
  await page.getByText("FRAME DETAILS", { exact: true }).evaluate((item) => {
    item.parentElement.open = true;
  });
  for (const [frame, label] of [
    [1, "valid GPU"],
    [4, "missing GPU"],
    [243, "rejected timestamps and spike"],
  ]) {
    await page.getByLabel("Frame position", { exact: true }).fill(String(frame));
    await page.getByLabel("Frame position", { exact: true }).press("Tab");
    await expect(page.locator("[data-viewer-frame]")).toContainText(`#${frame}`);
    await page.locator("[data-viewer-frame]").scrollIntoViewIfNeeded();
    await take(`viewer-frame-${frame}`, `Viewer / ${label}`);
  }
  await page.getByText("GPU coverage & timestamp evidence", { exact: true }).evaluate((item) => {
    item.parentElement.open = true;
  });
  await page.locator("[data-viewer-gpu-evidence]").scrollIntoViewIfNeeded();
  await take("viewer-rejected-evidence", "Viewer / rejected timestamp evidence");
  await page.locator("[data-viewer-gpu]").scrollIntoViewIfNeeded();
  await take("viewer-raw-timestamps", "Viewer / raw GPU diagnostics");
  await page.getByLabel("Open recording or comparison").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await take("viewer-import-error", "Viewer / invalid import preserves recording");
  await page.getByRole("button", { name: "Copy frame", exact: true }).click();
  await expect(page.locator("[data-copy-fallback]")).toBeVisible();
  await page.locator("[data-copy-fallback]").scrollIntoViewIfNeeded();
  await take("viewer-copy-fallback", "Viewer / clipboard fallback evidence");
  await open("mock-episode.json");
  await page.locator("[data-viewer-frame]").scrollIntoViewIfNeeded();
  await take("viewer-episode", "Viewer / sustained slowdown episode");
  await open("mock-comparison.json");
  await page.locator(".jank-viewer-timeline").evaluate((item) => {
    item.scrollTop = 0;
  });
  await page.locator(".jank-viewer-inspector").evaluate((item) => {
    item.scrollTop = 0;
  });
  await take("viewer-comparison", "Viewer / A/B overlays");
  await page.getByLabel("Show B", { exact: true }).uncheck();
  await take("viewer-comparison-a", "Viewer / A only");
  await page.getByLabel("Show B", { exact: true }).check();
  await page.getByLabel("Show A", { exact: true }).uncheck();
  await take("viewer-comparison-b", "Viewer / B only");
  await page.getByLabel("Show A", { exact: true }).check();
  for (const title of ["VIEW", "COMPARISON DETAILS"]) {
    const summary = page.getByText(title, { exact: true });
    await summary.evaluate((item) => {
      item.parentElement.open = true;
    });
    await summary.scrollIntoViewIfNeeded();
    await take(
      `viewer-comparison-${title.toLowerCase().replaceAll(" ", "-")}`,
      `Viewer / A/B ${title}`,
    );
  }
  for (const title of [
    "Trial coverage",
    "Scene setting differences",
    "Paired CPU measurements",
    "Paired GPU measurements",
  ]) {
    await page.getByRole("region", { name: title, exact: true }).scrollIntoViewIfNeeded();
    await take(`viewer-${title.toLowerCase().replaceAll(" ", "-")}`, `Viewer / ${title}`);
  }
  await page.getByText("VIEW", { exact: true }).evaluate((item) => {
    item.parentElement.open = false;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["mock-recording.json", "mock-comparison.json"]) {
    await open(name);
    await page.locator(".jank-viewer-timeline").evaluate((item) => {
      item.scrollTop = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await take(`viewer-narrow-${name.slice(5, -5)}`, `Narrow viewer / ${name.slice(5, -5)}`);
    await page.locator("[data-viewer-frame]").scrollIntoViewIfNeeded();
    await take(
      `viewer-narrow-inspector-${name.slice(5, -5)}`,
      `Narrow viewer / ${name.slice(5, -5)} inspector`,
    );
  }
  return [...summaries, "COMPARISON DETAILS"];
}
