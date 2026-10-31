import { expect } from "@playwright/test";

export async function capturePanels(page, take) {
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  for (const id of ["foundation", "behavior"]) {
    await take(`library-${id}`, `Library / ${id}`, page.locator(`#${id}`));
  }
  for (const tab of ["Buttons", "Fields", "Disclosure"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    if (tab === "Disclosure") {
      await page.locator("#controls details").evaluateAll((items) => {
        for (const item of items) {
          item.open = true;
        }
      });
    }
    await take(`controls-${tab.toLowerCase()}`, `Controls / ${tab}`, page.locator("#controls"));
  }
  await page.getByRole("tab", { name: "Buttons", exact: true }).focus();
  await take("controls-keyboard-focus", "Controls / keyboard focus", page.locator("#controls"));
  const panel = page.locator("#full-preview .jank");
  for (const mode of ["full", "mini", "line"]) {
    await take(`panel-${mode}`, `Panel / ${mode} mode`, page.locator(`#${mode}-preview .jank`));
  }
  const inventory = [];
  for (const tab of ["live", "loading", "capture"]) {
    await panel.locator(`[data-tab="${tab}"]`).click();
    await take(`tab-${tab}`, `Panel / ${tab.toUpperCase()} tab`, panel);
    const sections = panel.locator(`[data-tabpanel="${tab}"] [data-section]`);
    const names = await sections.evaluateAll((items) => items.map((item) => item.dataset.section));
    for (const name of names) {
      inventory.push(name);
      await sections.evaluateAll((items, selected) => {
        for (const item of items) {
          item.open = item.dataset.section === selected;
        }
      }, name);
      const section = panel.locator(`[data-section="${name}"]`);
      await section.locator(":scope > summary").scrollIntoViewIfNeeded();
      await take(`group-${name}`, `Panel / ${tab.toUpperCase()} / ${name}`, panel);
      await section
        .locator(":scope > div")
        .last()
        .evaluate((item) => item.scrollIntoView({ block: "end" }));
      await take(`group-${name}-bottom`, `Panel / ${name} / lower content`, panel);
    }
    await sections.evaluateAll((items) => {
      for (const item of items) {
        item.open = false;
      }
    });
    await take(`collapsed-${tab}`, `Panel / ${tab.toUpperCase()} / all groups collapsed`, panel);
  }
  await panel.locator('[data-tab="live"]').click();
  await panel.locator('[data-section="gpu"]').evaluate((item) => {
    item.open = true;
  });
  for (const state of ["valid", "missing", "rejected", "pending", "unsupported", "error"]) {
    await page.locator("#gpu-example").selectOption(state);
    await take(`gpu-${state}`, `GPU / ${state}`, panel);
  }
  await page.locator("#gpu-example").selectOption("valid");
  await panel.locator("[data-gpu-explanation]").evaluate((item) => {
    item.open = true;
  });
  await take("gpu-notes", "GPU / measurement explanation", panel);
  await panel.getByRole("button", { name: "FREEZE", exact: true }).click();
  await take("panel-frozen", "Panel / frozen display", panel);
  await panel.getByRole("button", { name: "RESUME", exact: true }).click();
  await panel.locator('[data-section="gpu"]').evaluate((item) => {
    item.open = false;
  });
  await panel.locator('[data-section="temporal"]').evaluate((item) => {
    item.open = true;
  });
  for (const mode of ["motion", "history"]) {
    await panel.getByLabel("Temporal debug view").selectOption(mode);
    await panel.getByLabel("Temporal debug view").scrollIntoViewIfNeeded();
    await take(`temporal-${mode}`, `Temporal / ${mode} debug selection (simulated)`, panel);
  }
  await panel.locator('[data-tab="loading"]').click();
  await panel.locator('[data-tabpanel="loading"] details').evaluateAll((items) => {
    for (const item of items) {
      item.open = true;
    }
  });
  for (const state of ["loading", "failed", "cancelled", "ready", "empty"]) {
    await page.locator("#loading-example").selectOption(state);
    await take(`loading-${state}`, `Loading / ${state}`, panel);
  }
  await page.locator("#loading-example").selectOption("ready");
  await panel.locator('[data-tab="capture"]').click();
  await panel.locator('[data-section="instrumentation"]').evaluate((item) => {
    item.open = true;
  });
  await panel.getByRole("button", { name: "TRACE", exact: true }).click();
  await take("trace-enabled", "Instrumentation / TRACE enabled", panel);
  await panel.locator('[data-section="instrumentation"]').evaluate((item) => {
    item.open = false;
  });
  await panel.locator('[data-section="automatic"]').evaluate((item) => {
    item.open = true;
  });
  await panel.getByLabel("Trigger mode", { exact: true }).selectOption("sustained");
  await panel.getByLabel("Capture window", { exact: true }).selectOption("episode");
  await panel.getByLabel("Trigger mode", { exact: true }).scrollIntoViewIfNeeded();
  await take("automatic-episode-settings", "Automatic capture / sustained episode settings", panel);
  await panel.getByRole("button", { name: "Arm automatic capture" }).click();
  await take("automatic-armed", "Automatic capture / armed", panel);
  await panel.getByRole("button", { name: "DISARM", exact: true }).click();
  await panel.getByLabel("Trigger mode", { exact: true }).selectOption("spike");
  await panel.getByLabel("Capture window", { exact: true }).selectOption("frames");
  await panel.getByLabel("Threshold ms", { exact: true }).fill("25");
  await panel.getByLabel("After frames", { exact: true }).fill("10");
  await panel.getByRole("button", { name: "Arm automatic capture" }).click();
  await page.locator("#spike").click();
  await page.locator("#advance-stream").click();
  await panel.locator('[data-tab="live"]').click();
  await expect(panel.getByRole("button", { name: "Inspect trigger", exact: true })).toBeVisible();
  await take("automatic-saved", "Automatic capture / saved notification", panel);
  await panel.getByRole("button", { name: "Inspect trigger", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await take("automatic-inspector", "Automatic capture / trigger inspector");
  await page.getByRole("dialog").getByRole("button", { name: /close/i }).press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await panel.getByRole("button", { name: "REC", exact: true }).click();
  await page.locator("#advance-stream").click();
  await panel.locator('[data-tab="capture"]').click();
  await panel.locator('[data-section="automatic"]').evaluate((item) => {
    item.open = false;
  });
  await panel.locator('[data-section="completeness"]').evaluate((item) => {
    item.open = true;
  });
  await take("manual-recording", "Capture / manual recording and capacity", panel);
  await panel.locator('[data-tab="live"]').click();
  await panel.getByRole("button", { name: "STOP REC", exact: true }).click();
  await panel.locator('[data-tab="capture"]').click();
  await panel.locator('[data-section="comparison"]').evaluate((item) => {
    item.open = true;
  });
  await panel.getByLabel("Warm-up seconds", { exact: true }).fill("0.5");
  await panel.getByLabel("Measurement seconds", { exact: true }).fill("1");
  await panel.getByLabel("Pairs", { exact: true }).fill("2");
  await panel.getByRole("button", { name: "Run A/B comparison", exact: true }).click();
  await take("comparison-running", "Panel / A/B comparison running", panel);
  for (let step = 0; step < 30; step += 1) {
    await page.locator("#advance-stream").click();
    if ((await panel.locator("[data-comparison-status]").textContent()).includes("complete")) {
      break;
    }
  }
  await expect(panel.locator("[data-comparison-status]")).toContainText("complete");
  await panel.locator("[data-comparison-summary]").scrollIntoViewIfNeeded();
  await take("comparison-complete", "Panel / A/B comparison results", panel);
  await panel
    .locator("[data-comparison-trials] details")
    .first()
    .evaluate((item) => {
      item.open = true;
    });
  await panel.locator("[data-comparison-trials] details").first().scrollIntoViewIfNeeded();
  await take("comparison-trial", "Panel / A/B trial details", panel);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["live", "loading", "capture"]) {
    await panel.locator(`[data-tab="${tab}"]`).click();
    await take(`narrow-${tab}`, `Narrow panel / ${tab.toUpperCase()}`, panel);
  }
  return inventory;
}
