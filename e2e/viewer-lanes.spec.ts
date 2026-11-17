import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`aligned lanes share selection, range and keyboard controls in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto(`/checks/viewer.html?theme=${theme}`);
    const timeline = page.getByRole("region", { name: "Recording timeline", exact: true });
    const frame = page.getByRole("slider", { name: "Selected frame", exact: true });
    const cpu = page.getByRole("slider", { name: "Animation cpu lane", exact: true });
    const gpu = page.getByRole("slider", { name: "Scene ×1 gpu lane", exact: true });
    const context = page.getByRole("slider", { name: "Unattributed context lane", exact: true });
    await expect(page.getByRole("region", { name: "CPU scopes", exact: true })).toContainText(
      "0–70 ms · shared CPU scale",
    );
    await expect(page.getByRole("region", { name: "GPU passes", exact: true })).toContainText(
      "0–4 ms · GPU clock, separate scale",
    );
    await expect(gpu).toHaveAttribute("aria-valuetext", /rejected.*GPU counter reset/);
    await expect(context).toHaveAttribute("aria-valuetext", /0.30 milliseconds/);
    const tracks = timeline.getByRole("slider");
    const boxes = await tracks.evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        return { x: box.x, width: box.width };
      }),
    );
    expect(new Set(boxes.map((box) => `${box.x}:${box.width}`)).size).toBe(1);
    expect(
      new Set(
        await timeline
          .locator("[data-lane-cursor]")
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x)),
      ).size,
    ).toBe(1);
    await page.mouse.move(0, 0);
    expect((await cpu.boundingBox())?.height).toBe(20);
    const laneLayout = () =>
      timeline.locator("[data-timing-lane]").evaluateAll((lanes) => {
        const origin =
          lanes[0]?.closest('[aria-label="Recording timeline"]')?.getBoundingClientRect().top ?? 0;
        return lanes.map((lane) => {
          const box = lane.getBoundingClientRect();
          return { top: box.top - origin, height: box.height };
        });
      });
    const beforeHover = await laneLayout();
    await cpu.hover();
    expect(await laneLayout()).toEqual(beforeHover);
    await cpu.focus();
    expect((await cpu.boundingBox())?.height).toBe(20);
    expect(await laneLayout()).toEqual(beforeHover);
    await page.mouse.move(0, 0);
    expect(await laneLayout()).toEqual(beforeHover);
    await cpu.press("ArrowLeft");
    for (const track of [frame, gpu, context])
      await expect(track).toHaveAttribute("aria-valuenow", "241");
    await gpu.press("Home");
    await expect(gpu).toHaveAttribute("aria-valuetext", /no record/);
    await expect(gpu.locator("[data-lane-missing]")).not.toHaveAttribute("d", "");
    await gpu.press("ArrowRight");
    await expect(gpu).toHaveAttribute("aria-valuetext", /milliseconds.*Recorded GPU duration/);
    await page.getByRole("button", { name: /Events at frame 1485:/ }).focus();
    await expect(frame).toHaveAttribute("aria-valuenow", "242");
    await expect(timeline.locator("[data-viewer-event-readout]")).toContainText("Camera reset");
    await page.getByRole("button", { name: "Expand quiet lanes", exact: true }).click();
    expect((await cpu.boundingBox())?.height).toBe(32);
    await page.getByText("Lanes", { exact: true }).click();
    await page.getByRole("checkbox", { name: "GPU passes", exact: true }).uncheck();
    await expect(gpu).toHaveCount(0);
    await expect(frame).toHaveAttribute("aria-valuenow", "242");
    await page.getByRole("checkbox", { name: "GPU passes", exact: true }).check();
    await page.getByRole("checkbox", { name: "Expand quiet lanes", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Expand quiet lanes", exact: true }).press("Escape");
    await expect(page.getByRole("checkbox", { name: "GPU passes", exact: true })).toBeHidden();
    await expect(page.getByText("Lanes", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: /Events at frame 1485:/ }).press("End");
    await expect(frame).toBeFocused();
    await expect(frame).toHaveAttribute("aria-valuenow", "359");
    await context.focus();
    await context.press("End");
    for (const track of [frame, cpu, gpu])
      await expect(track).toHaveAttribute("aria-valuenow", "359");
    const before = await page.locator("[data-range-readout]").textContent();
    await page.getByRole("button", { name: "Worst", exact: true }).click();
    await expect(page.locator("[data-range-readout]")).toHaveText(before ?? "");
    await timeline.scrollIntoViewIfNeeded();
    await info.attach(`Aligned lanes ${theme}`, {
      body: await timeline.screenshot(),
      contentType: "image/png",
    });
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1024, height: 604 });
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await context.focus();
    await context.press("Home");
    await expect(frame).toHaveAttribute("aria-valuenow", "0");
  });
}

test("missing channels stay unknown and long lane lists are paged without losing navigation", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?missing");
  await expect(page.getByRole("region", { name: "CPU scopes", exact: true })).toContainText(
    "No CPU scope lanes retained",
  );
  await expect(page.getByRole("region", { name: "GPU passes", exact: true })).toContainText(
    "No per-invocation GPU timings retained",
  );
  await expect(
    page.getByRole("slider", { name: "Unattributed context lane", exact: true }),
  ).toHaveAttribute("aria-valuetext", /unknown.*coverage is required/);
  await expect(
    page.getByRole("slider", { name: "Profiler context lane", exact: true }),
  ).toHaveAttribute("aria-valuetext", /unknown.*Legacy recordings/);
  await page.goto("/checks/viewer.html?many-lanes");
  const cpu = page.getByRole("region", { name: "CPU scopes", exact: true });
  await expect(cpu.getByRole("slider")).toHaveCount(16);
  await expect(cpu).toContainText("1–16 of 34 lanes");
  await cpu.getByRole("button", { name: "Next lanes", exact: true }).click();
  await expect(cpu).toContainText("17–32 of 34 lanes");
  await cpu.getByRole("slider").first().press("Home");
  await expect(page.getByRole("slider", { name: "Selected frame", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await cpu.getByRole("button", { name: "Next lanes", exact: true }).click();
  await expect(cpu.getByRole("slider")).toHaveCount(2);
  await page.goto("/checks/viewer.html?large");
  await page.getByRole("slider", { name: "Scene ×1 gpu lane", exact: true }).press("End");
  await expect(page.getByRole("slider", { name: "Selected frame", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "5999",
  );
  expect(await page.locator('svg path[d*="NaN"], svg path[d*="Infinity"]').count()).toBe(0);
});
