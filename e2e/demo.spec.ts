import { expect, test } from "@playwright/test";

test("synthetic CPU/GPU demo animates, injects spikes, preserves Freeze and tears down on source change", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto("/?demo");
  const demo = page.getByRole("region", { name: "Synthetic performance demo" });
  const panel = demo.getByRole("region", { name: "Live performance panel" });
  await expect(
    page.getByText(
      "Synthetic demonstration: all timings are simulated, not measurements of your device.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel).toBeVisible();
  const first = Number(await panel.getAttribute("data-frame"));
  await page.clock.runFor(500);
  expect(Number(await panel.getAttribute("data-frame"))).toBeGreaterThan(first);
  await demo.getByRole("button", { name: "Inject 80ms spike", exact: true }).click();
  await page.clock.runFor(250);
  await expect(panel.locator('[data-metric="Worst"] [data-value]')).toHaveText("80.0 ms");
  await expect(panel.getByText("100 ms", { exact: true })).toBeVisible();
  await expect(panel.getByText("0 ms", { exact: true })).toHaveCount(0);
  await demo.getByRole("button", { name: "CPU burst · 2s", exact: true }).click();
  await page.clock.runFor(1750);
  const cpu = panel.locator('[title="Simulation"] + span');
  expect(Number(await cpu.textContent())).toBeGreaterThan(8);
  await demo.getByRole("button", { name: "GPU burst · 2s", exact: true }).click();
  await page.clock.runFor(250);
  await expect(demo.getByText("Synthetic · GPU burst", { exact: true })).toBeVisible();
  const gpu = panel.locator('[title="Timed GPU work"] + span');
  expect(Number(await gpu.textContent())).toBeGreaterThan(25);
  await expect(panel.getByText(/age 2 frames/)).toBeVisible();
  await panel.getByRole("button", { name: "Freeze", exact: true }).click();
  const held = await panel.getAttribute("data-frame");
  const line = await panel.locator('[data-chart="line"]').getAttribute("d");
  await page.clock.runFor(1000);
  await expect(panel).toHaveAttribute("data-frame", held ?? "");
  await expect(panel.locator('[data-chart="line"]')).toHaveAttribute("d", line ?? "");
  await panel.getByRole("button", { name: "Resume", exact: true }).click();
  expect(Number(await panel.getAttribute("data-frame"))).toBeGreaterThan(Number(held));
  await demo.getByRole("button", { name: "Pause demo", exact: true }).click();
  const paused = await panel.getAttribute("data-frame");
  await page.clock.runFor(1000);
  await expect(panel).toHaveAttribute("data-frame", paused ?? "");
  await expect(demo.getByText("Synthetic · Paused", { exact: true })).toBeVisible();
  await testInfo.attach("synthetic-demo", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await demo.getByRole("button", { name: "Play demo", exact: true }).click();
  await page.clock.runFor(250);
  expect(Number(await panel.getAttribute("data-frame"))).toBeGreaterThan(Number(paused));
  await page.getByRole("combobox", { name: "Preview source" }).selectOption("empty");
  await expect(demo).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(page.getByRole("region", { name: "Live performance panel" })).toHaveAttribute(
    "data-frame",
    "unknown",
  );
  expect(await page.locator("style[data-panel-properties]").count()).toBe(1);
  expect(errors).toEqual([]);
});
