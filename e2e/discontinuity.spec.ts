import { expect, test } from "@playwright/test";
import { analyzeRecording } from "../src/agent/analyze.ts";
import { parseRecording } from "../src/recording/format.ts";
import { origin, servePackage } from "./serve-package.ts";

test("a host can exclude a known pause and reopen the capture in the packaged viewer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await servePackage(page, "<!doctype html><title>Paused host</title>");
  await page.goto(origin);
  const json: string = await page.evaluate(async () => {
    const entry = "/index.js";
    const { createDiagnostics, serializeRecording } = await import(entry);
    let now = 0;
    const monitor = createDiagnostics({ now: () => now });
    monitor.startRecording();
    monitor.beginFrame(now);
    for (let block = 0; block < 2; block++) {
      for (let frame = 0; frame < 120; frame++) {
        monitor.endFrame(2, 0);
        now += 1000 / 60;
        monitor.beginFrame(now);
      }
      if (block === 0) {
        monitor.resetFrame();
        now += 7200;
        monitor.beginFrame(now);
      }
    }
    monitor.stopRecording();
    const json = serializeRecording(monitor.export());
    monitor.dispose();
    return json;
  });
  const report = analyzeRecording(parseRecording(json));
  expect(report.summary).toMatchObject({ frames: 240, fps: 60, durationMs: 11200 });
  expect(report.summary.frameMs?.worst).toBe(16.67);
  expect(report.summary.overBudget.frames).toBe(0);
  expect(report.episodes).toEqual([]);
  await page.goto(`${origin}/viewer.html`);
  await page.getByLabel("Open recording or comparison file").setInputFiles({
    name: "paused-host.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByRole("region", { name: "Selected frame details" })).toBeVisible();
  await expect(page.getByText(/240 frames/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
