import { expect, test, type Page } from "@playwright/test";

import { pathToFileURL } from "node:url";

import { resolve } from "node:path";

import { createDiagnostics } from "../src/core/diagnostics.ts";

const windowLength = (value: string) => {
  const [, left, right] = /range (\d+) to (\d+)/.exec(value)!;

  return Number(right) - Number(left);
};

function recording() {
  let now = 0;

  const monitor = createDiagnostics({ now: () => now });

  monitor.startRecording();

  monitor.beginFrame(now);

  for (let i = 0; i < 600; i++) {
    now += i === 300 ? 40 : 10;

    monitor.beginFrame(now);
  }

  return Buffer.from(JSON.stringify(monitor.export()));
}

async function clickPaintedFrame(page: Page) {
  await expect
    .poll(() =>
      page
        .locator('canvas[data-k="timeline"]')
        .evaluate((canvas: HTMLCanvasElement) =>
          Math.abs(
            canvas.width / devicePixelRatio -
              canvas.getBoundingClientRect().width,
          ),
        ),
    )
    .toBeLessThan(1);

  const range = await page.locator('[data-k="s-range"]').textContent();

  const first = Number(/range (\d+) to/.exec(range!)![1]);

  const point = await page
    .locator('canvas[data-k="timeline"]')
    .evaluate((canvas: HTMLCanvasElement) => {
      const box = canvas.getBoundingClientRect();

      const logicalWidth = canvas.width / devicePixelRatio;

      // Target the centre of the 21st painted bar, regardless of any CSS scaling.
      return {
        x: box.left + ((160 + 20 * 4 + 1.5) * box.width) / logicalWidth,
        y: box.top + 70,
      };
    });

  await page.mouse.click(point.x, point.y);

  await expect(page.getByRole("slider", { name: "Playhead" })).toHaveAttribute(
    "aria-valuenow",
    String(first + 20),
  );
}

for (const offline of [false, true]) {
  test(`first-load pointer selection matches painted frames (${offline ? "offline" : "hosted"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1260, height: 900 });

    await page.goto(
      offline
        ? pathToFileURL(resolve("OPEN RECORDING VIEWER.html")).href
        : "/viewer/",
    );

    await expect(page.locator('[data-k="empty"]')).toBeVisible();

    // The empty viewer settles before its previously hidden canvases are revealed.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );

    await page.getByLabel("Recording file").setInputFiles({
      name: "pointer.json",
      mimeType: "application/json",
      buffer: recording(),
    });

    await expect(page.locator('[data-k="s-range"]')).toContainText("range");

    await clickPaintedFrame(page);

    const session = page.locator('canvas[data-k="session"]');

    await expect(session).toHaveCSS("cursor", "grab");

    const before = await page.locator('[data-k="s-range"]').textContent();

    const first = Number(/range (\d+) to/.exec(before!)![1]);

    const box = (await session.boundingBox())!;

    // Start near the left range edge: this pans the whole range, never resizes it.
    const x = box.x + (first / 600) * box.width + 3;

    await page.mouse.move(x, box.y + 40);

    await page.mouse.down();

    await expect(session).toHaveCSS("cursor", "grabbing");

    await page.mouse.move(x + 40, box.y + 40, { steps: 3 });

    await page.mouse.up();

    await expect(session).toHaveCSS("cursor", "grab");

    await expect(page.locator('[data-k="s-range"]')).not.toHaveText(before!);

    const after = await page.locator('[data-k="s-range"]').textContent();

    expect(windowLength(after!)).toBe(windowLength(before!));

    await page.mouse.down();

    await session.dispatchEvent("pointercancel");

    await expect(session).toHaveCSS("cursor", "grab");

    await page.mouse.move(x + 100, box.y + 40);

    await page.mouse.up();

    await expect(page.locator('[data-k="s-range"]')).toHaveText(after!);

    await page.setViewportSize({ width: 900, height: 900 });

    await clickPaintedFrame(page);

    await page.setViewportSize({ width: 1680, height: 900 });

    await clickPaintedFrame(page);
  });
}
