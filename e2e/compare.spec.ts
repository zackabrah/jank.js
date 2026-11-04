import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { parseComparison } from "../src/compare/model.ts";

for (const theme of ["dark", "light"]) {
  test(`comparison plan, capture guards and partial export in ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/checks/compare.html");
    const review = page.getByRole("region", { name: `Comparison review ${theme}`, exact: true });
    const panel = review.getByRole("region", { name: "Live performance panel" });
    const body = panel.getByRole("tabpanel", { name: /^Compare/ });
    await expect(body).toContainText("1 other setting differs: objects");
    const planSection = body.getByRole("region", { name: "Comparison plan", exact: true });
    const layout = await planSection.evaluate((section) => {
      const fields = [...section.querySelectorAll("input")].map(
        (field) => field.getBoundingClientRect().y,
      );
      const button = section.querySelector("button")?.getBoundingClientRect();
      const slot = section.querySelector("li");
      const measure = slot?.children[1];
      return {
        fields,
        buttonWidth: button?.width,
        width: section.clientWidth,
        slotHeight: slot?.getBoundingClientRect().height,
        fraction: measure && slot ? measure.getBoundingClientRect().width / slot.clientWidth : null,
      };
    });
    expect(layout.fields[0]).toBeLessThan(layout.fields[1] ?? 0);
    expect(layout.fields[1]).toBeLessThan(layout.fields[2] ?? 0);
    expect(layout.buttonWidth).toBe(layout.width);
    expect(layout.slotHeight).toBe(24);
    expect(layout.fraction).toBeCloseTo(0.5, 1);
    await info.attach(`Comparison plan ${theme}`, {
      body: await planSection.screenshot(),
      contentType: "image/png",
    });

    await body.getByRole("button", { name: "Host settings" }).click();
    await expect(body.getByRole("cell", { name: "128", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Auto", exact: true }).click();
    const run = body.getByRole("button", { name: "Run comparison", exact: true });
    await expect(run).toHaveAttribute("aria-disabled", "true");
    await run.press("Enter");
    await expect(
      body.getByText("Turn off automatic capture before comparing.", { exact: true }),
    ).toBeFocused();
    await expect(body.getByRole("alert")).toHaveCount(0);
    await panel.getByRole("button", { name: "Auto", exact: true }).click();
    const measure = body.getByLabel("Measure per trial (seconds)");
    await measure.fill("0");
    await expect(measure).toHaveAttribute("aria-invalid", "true");
    await expect(body.getByText("Measure per trial: 0.1 to 30 s.")).toBeVisible();
    // The preview keeps the last valid plan instead of falling back to defaults.
    await expect(
      body.getByRole("list", { name: "Trial schedule" }).getByRole("listitem"),
    ).toHaveCount(4);
    await expect(run).toHaveAttribute("aria-disabled", "true");
    await run.press("Enter");
    await expect(measure).toBeFocused();
    await measure.fill("1");
    await expect(measure).not.toHaveAttribute("aria-invalid", "true");
    await expect(body.getByText("Measure per trial: 0.1 to 30 s.")).toHaveCount(0);
    await run.click();
    await expect(panel.getByRole("tab", { name: "Compare, trial 1 of 4" })).toBeVisible();
    const badges = panel.locator("[data-state-badges]:visible");
    await expect(badges.getByRole("status", { name: "Comparison running" })).toBeVisible();
    await expect(badges.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
    await expect(badges.getByRole("status", { name: "Recording", exact: true })).toHaveCount(0);
    const rec = panel.getByRole("button", { name: "Rec", exact: true });
    await expect(rec).toHaveAttribute("aria-disabled", "true");
    await rec.press("Enter");
    await expect(panel.locator("[data-panel-notice]")).toContainText(
      "Stop the comparison before recording",
    );
    // Said once: the Compare tab's trial card already has Stop comparison and the lock status.
    await expect(panel.getByRole("button", { name: /Stop comparison/ })).toHaveCount(1);
    await expect(body).toContainText("Rec and Auto locked until the run ends");
    await rec.press("r");
    await rec.press("a");
    await expect(body.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Start recording" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await panel.getByRole("switch", { name: "Automatic capture" }).press("Space");
    await expect(panel.getByRole("tab", { name: "Compare, trial 1 of 4" })).toBeVisible();
    await panel.getByRole("tab", { name: /^Compare/ }).click();
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await review.getByRole("button", { name: "Finish current trial" }).click();
    await expect(panel.getByRole("tab", { name: "Compare, trial 2 of 4" })).toBeVisible();
    await expect(body.getByRole("region", { name: "Finished comparison trials" })).toContainText(
      "1A",
    );
    await info.attach(`Comparison running ${theme}`, {
      body: await panel.screenshot(),
      contentType: "image/png",
    });
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await panel.getByRole("button", { name: "Mini view", exact: true }).click();
    await expect(
      panel
        .locator("[data-state-badges]:visible")
        .getByRole("status", { name: "Comparison running" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Line view", exact: true }).click();
    await expect(panel).toContainText("p95");
    await expect(
      panel
        .locator("[data-state-badges]:visible")
        .getByRole("status", { name: "Loading", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: /^Expand to full panel/ }).click();
    await body.getByRole("button", { name: /Stop comparison/ }).click();
    await expect(body).toContainText("Stopped after 1 of 4 trials");
    const downloaded = page.waitForEvent("download");
    await body.getByRole("button", { name: "Export 1 trial" }).click();
    const path = await (await downloaded).path();
    if (!path) throw new Error("Missing comparison download");
    const bundle = parseComparison(await readFile(path, "utf8"));
    expect(bundle.status).toBe("stopped");
    expect(bundle.trials).toHaveLength(1);
    await expect(rec).not.toHaveAttribute("aria-disabled", "true");
    expect(errors).toEqual([]);
  });
}

test("comparison completes ABBA and preserves trials on external interruption", async ({
  page,
}, info) => {
  await page.goto("/checks/compare.html");
  const review = page.getByRole("region", { name: "Comparison review dark", exact: true });
  const panel = review.getByRole("region", { name: "Live performance panel" });
  const body = panel.getByRole("tabpanel", { name: /^Compare/ });
  await body.getByRole("button", { name: "Run comparison", exact: true }).click();
  for (let trial = 1; trial <= 4; trial++) {
    await review.getByRole("button", { name: "Finish current trial" }).click();
    await expect(body.getByRole("region", { name: "Finished comparison trials" })).toContainText(
      `${trial} / 4`,
    );
  }
  await expect(panel.getByRole("tab", { name: "Compare, complete" })).toBeVisible();
  // Results lead; a passing trial list waits behind its disclosure.
  await expect(body.getByRole("button", { name: /^Trials/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(body.getByRole("article", { name: "GPU verdict" })).toContainText("not recorded");
  await body.getByRole("button", { name: /^Trials/ }).click();
  await expect(
    body.getByRole("region", { name: "Finished comparison trials" }).getByRole("listitem"),
  ).toHaveCount(4);
  await info.attach("Completed ABBA plan", {
    body: await panel.screenshot(),
    contentType: "image/png",
  });
  // Unexported results are memory-only, so Run again asks before replacing them.
  const runAgain = body.getByRole("button", { name: "Run again" });
  await runAgain.click();
  const replace = body.getByRole("group", { name: "Replace unexported trials" });
  await expect(replace).toContainText("Running again replaces 4 unexported trials");
  await expect(replace.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(replace).toHaveCount(0);
  await expect(runAgain).toBeFocused();
  await expect(body.getByRole("region", { name: "Finished comparison trials" })).toContainText(
    "4 / 4",
  );
  await runAgain.click();
  await replace.getByRole("button", { name: "Replace and run" }).click();
  await review.getByRole("button", { name: "Finish current trial" }).click();
  await review.getByRole("button", { name: "External capture change" }).click();
  // An interruption takes the panel's single notice slot, not a note below the plan.
  await expect(panel.locator("[data-panel-notice]")).toContainText("Comparison cancelled");
  await expect(body).toContainText("Cancelled after 1 of 4 trials");
  await expect(body.getByText("A recording is running outside this panel.")).toBeVisible();
  const download = page.waitForEvent("download");
  await body.getByRole("button", { name: "Export 1 trial" }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing comparison download");
  await page.goto("/viewer.html");
  await page.getByLabel("Open recording or comparison file").setInputFiles(path);
  const viewer = page.locator("[data-comparison-view]");
  await expect(viewer).toContainText("Comparison interrupted. Comparison cancelled");
  await expect(viewer).toContainText("1 of 4 trials retained");
  await expect(viewer.getByRole("article", { name: "CPU verdict" })).toContainText("Unknown");
});

for (const theme of ["dark", "light"]) {
  test(`comparison results explain verdicts, coverage and opposing scopes in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto("/checks/compare.html#results");
    const review = page.getByRole("region", { name: `Comparison results ${theme}`, exact: true });
    const select = review.getByLabel(`Result case · ${theme}`);
    const cpu = review.getByRole("article", { name: "CPU verdict", exact: true });
    const gpu = review.getByRole("article", { name: "GPU verdict", exact: true });
    const frame = review.getByRole("article", { name: "Frame verdict", exact: true });
    await expect(cpu).toContainText("B slower");
    await expect(cpu).toContainText("+2.00 to +4.00 ms");
    await expect(gpu).toContainText("No observed difference");
    await expect(frame).toContainText("Inconclusive");
    const scroll = review.locator("[data-compare-scroll]");
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await select.selectOption("faster");
    await expect(cpu).toContainText("B faster");
    await select.selectOption("gpu-gap");
    await expect(gpu).toContainText("Unknown");
    await expect(gpu).toContainText("Trial 1B");
    const y = await page.evaluate(() => window.scrollY);
    await gpu.getByRole("button", { name: "View trial", exact: true }).click();
    const trial = review.getByRole("listitem", { name: "Trial 1B", exact: true });
    await expect(trial).toBeFocused();
    await expect(trial).toContainText("80% is required");
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    await info.attach(`Comparison failing trial ${theme}`, {
      body: await scroll.screenshot(),
      contentType: "image/png",
    });
    await select.selectOption("scope-shifts");
    await expect(cpu).toContainText("No observed difference");
    await expect(cpu).toContainText("Scopes moved in opposite directions");
    const scopes = review.getByRole("region", { name: "Largest per-scope changes", exact: true });
    await expect(scopes).toContainText("heuristic");
    await expect(scopes).toContainText("+2.00");
    await expect(scopes).toContainText("−2.00");
    await expect(scopes).toContainText("Settings differences do not establish causes");
    const method = review.getByRole("region", { name: "Comparison method", exact: true });
    await expect(method).toContainText("Quick estimate, not a significance test");
    await method.getByRole("button", { name: /^Method/ }).click();
    await expect(method).toContainText("not a confidence interval");
    await expect(method).toContainText("does not establish equal performance");
    await info.attach(`Comparison scope changes ${theme}`, {
      body: await scroll.screenshot(),
      contentType: "image/png",
    });
    await select.selectOption("stopped");
    await expect(cpu).toContainText("Trial 2A was not completed");
    await cpu.getByRole("button", { name: "View trial", exact: true }).click();
    await expect(review.getByRole("listitem", { name: "Trial 2A", exact: true })).toBeFocused();
    await select.selectOption("low-samples");
    await expect(frame).toContainText("10 Frame samples; 20 are required");
    await select.selectOption("low-window");
    await expect(frame).toContainText("measurement window");
  });
}
