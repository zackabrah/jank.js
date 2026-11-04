import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { dist, origin, servePackage } from "./serve-package.ts";

const host = `<!doctype html><html><head><title>Consumer</title><script type="importmap">
{"imports":{"jank.js":"/index.js","jank.js/panel":"/panel.js"}}</script></head>
<body><script type="module">
import { createDiagnostics } from "jank.js";
import { createPerformancePanel } from "jank.js/panel";
const monitor = createDiagnostics();
const panel = createPerformancePanel({ shell: document.body, monitor });
const physics = monitor.register("physics", "Physics", () => ({ bodies: 3 }));
const frame = (at) => {
  monitor.beginFrame(at);
  panel.refresh(at);
  const scope = physics.begin();
  physics.end(scope);
  monitor.endFrame(1, 1);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
window.destroyPanel = () => panel.destroy();
</script></body></html>`;

test.skip(!existsSync(join(dist, "panel.js")), "Run pnpm build:package first.");

test("the built package mounts, records and opens its lazy viewer with no dev server", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await servePackage(page, host);
  await page.goto(`${origin}/`);
  const panel = page.getByRole("region", { name: "Live performance panel" });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("Missing panel");
  // It floats in the default corner rather than joining the page's flow.
  expect(viewport.width - (box.x + box.width)).toBeCloseTo(20, 0);
  expect(box.y).toBeCloseTo(20, 0);
  await panel.getByRole("button", { name: "Rec", exact: true }).click();
  await panel.getByRole("tab", { name: /^Capture/ }).click();
  // Wait for frames, not time: a slow machine may seal none in a fixed wait, leaving nothing to save.
  await expect
    .poll(async () =>
      Number(
        await panel
          .getByRole("progressbar", { name: "Recording capacity", exact: true })
          .getAttribute("aria-valuenow"),
      ),
    )
    .toBeGreaterThan(3);
  await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
  const saved = panel.getByRole("listitem", { name: "Capture C1", exact: true });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Open", exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("region", { name: "Selected frame details" })).toBeVisible();
  await viewer.getByRole("button", { name: "Close viewer", exact: true }).click();
  await page.evaluate(() => Reflect.get(window, "destroyPanel")());
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the self-contained viewer opens an exported recording from one file", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await servePackage(page, "");
  await page.goto(`${origin}/viewer.html`);
  await expect(page.getByText(/Open a jank\.js recording/)).toBeVisible();
  // The whole file is one document: no asset requests beyond itself.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.reload();
  await expect(page.getByText(/Open a jank\.js recording/)).toBeVisible();
  expect(requests).toEqual([`${origin}/viewer.html`]);
  expect(errors).toEqual([]);
});
