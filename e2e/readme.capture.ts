import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const out = "docs/readme";
const gif = { fps: 12, width: 540, leadMs: 800, tailMs: 2400 };

/** Encodes screenshots taken in real time, so the loop plays at the speed it happened. */
function encodeGif(name: string, shots: { at: number; data: Buffer }[]) {
  const folder = mkdtempSync(join(tmpdir(), "jank-capture-"));
  try {
    const list = shots.flatMap((shot, index) => {
      const file = join(folder, `${index}.png`);
      writeFileSync(file, shot.data);
      const next = shots[index + 1]?.at ?? shot.at + 1000 / gif.fps;
      return [`file '${file}'`, `duration ${(next - shot.at) / 1000}`];
    });
    const concat = join(folder, "frames.txt");
    writeFileSync(concat, `${list.join("\n")}\n`);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-vf",
      // One palette for the whole loop, and no dithering: flat panel colours stay flat.
      `fps=${gif.fps},scale=${gif.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      "-loop",
      "0",
      join(out, `${name}.gif`),
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Films the element while `steps` run. Each shot waits for the last, then the loop ends. */
async function film(name: string, target: Locator, steps: () => Promise<void>) {
  const shots: { at: number; data: Buffer }[] = [];
  let filming = true;
  const done = steps().finally(() => {
    filming = false;
  });
  while (filming) {
    const data = await target.screenshot();
    shots.push({ at: performance.now(), data });
  }
  await done;
  encodeGif(name, shots);
}

const still = (target: Locator | Page, name: string) =>
  target.screenshot({ path: join(out, `${name}.png`) });

/** Downloads through the button, returning the file's contents. */
async function exported(page: Page, button: Locator) {
  const download = page.waitForEvent("download");
  await button.click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing export");
  return readFileSync(path);
}

/** Opens a file in the standalone viewer, under the name a person would see. */
async function openInViewer(page: Page, name: string, buffer: Buffer) {
  await page.goto("/viewer.html");
  await page
    .getByLabel("Open recording or comparison file")
    .setInputFiles({ name, mimeType: "application/json", buffer });
}

test("retake the README images from a real run", async ({ page }) => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("pnpm docs:captures needs ffmpeg on PATH for the running GIF.");
  }
  await page.goto("/checks/three.html?backend=webgpu");
  const preset = page.getByRole("button", { name: "Mixed", exact: true });
  await expect(preset).toBeEnabled({ timeout: 20_000 });
  await preset.click();
  const panel = page
    .getByRole("complementary", { name: "Live Jank panel" })
    .getByRole("region", { name: "Live performance panel" });
  const spike = page.getByRole("button", { name: "Inject 80 ms CPU spike" });
  // Let the preset switch's own slow frames leave the 180-frame graph, and its scale settle.
  await page.waitForTimeout(6000);

  await film("panel-running", panel, async () => {
    await page.waitForTimeout(gif.leadMs);
    await spike.click();
    await page.waitForTimeout(gif.tailMs);
  });

  await panel.getByRole("button", { name: "Mini view", exact: true }).click();
  await page.waitForTimeout(600);
  await still(panel, "panel-mini");
  await panel.getByRole("button", { name: "Line view", exact: true }).click();
  await page.waitForTimeout(600);
  await still(panel, "panel-line");
  await panel.getByRole("button", { name: /^Expand to full panel/ }).click();

  await page.getByRole("button", { name: "Load + compile", exact: true }).click();
  await expect(page.getByRole("status", { name: "Asset preparation status" })).not.toContainText(
    "Open the Loading tab",
    { timeout: 15_000 },
  );
  await panel.getByRole("tab", { name: /^Loading/ }).click();
  await page.waitForTimeout(800);
  await still(panel, "panel-loading");

  // A recording with spikes in it, so the viewer has something to show.
  await panel.getByRole("tab", { name: /^Capture/ }).click();
  await panel.getByRole("button", { name: "Start recording", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(900);
    await spike.click();
  }
  await page.waitForTimeout(900);
  await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
  const saved = panel.getByRole("listitem", { name: "Capture C1", exact: true });
  await expect(saved).toBeVisible({ timeout: 10_000 });
  const recording = await exported(
    page,
    saved.getByRole("button", { name: "Export capture C1", exact: true }),
  );
  await panel.getByRole("button", { name: "Dismiss saved capture notice" }).click();
  await panel.getByRole("tabpanel", { name: /^Capture/ }).evaluate((body) => {
    for (const element of [body, ...body.querySelectorAll("*")]) element.scrollTop = 0;
    for (let parent = body.parentElement; parent; parent = parent.parentElement)
      parent.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await still(panel, "panel-capture");

  // A real comparison of Baseline against CPU stress.
  await page.getByRole("button", { name: "Baseline", exact: true }).click();
  await panel.getByRole("tab", { name: /^Compare/ }).click();
  const compare = panel.getByRole("tabpanel", { name: /^Compare/ });
  await compare.getByLabel("Warm-up per trial (seconds)").fill("0.5");
  await compare.getByLabel("Measure per trial (seconds)").fill("1.5");
  await compare.getByLabel("Pairs").fill("2");
  await compare.getByRole("button", { name: "Run comparison", exact: true }).click();
  await expect(panel.getByRole("tab", { name: "Compare, complete" })).toBeVisible({
    timeout: 60_000,
  });
  const comparison = await exported(page, compare.getByRole("button", { name: "Export 4 trials" }));

  await openInViewer(page, "jank-recording.json", recording);
  await expect(page.getByRole("region", { name: "Selected frame details" })).toBeVisible();
  await page.waitForTimeout(400);
  await still(page, "viewer");

  await openInViewer(page, "jank-comparison.json", comparison);
  const view = page.locator("[data-comparison-view]");
  await expect(view.getByRole("article", { name: "CPU verdict" })).toContainText("B slower");
  await view.getByRole("tab", { name: "Frame", exact: true }).click();
  await page.getByRole("slider", { name: "Comparison elapsed time", exact: true }).press("PageUp");
  await page.waitForTimeout(400);
  await still(page, "viewer-compare");
});
