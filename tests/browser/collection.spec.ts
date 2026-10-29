import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";

test("the public profiler exports a captured recording that validates outside the browser", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/collection/");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(async () => Number(await page.getByLabel("Counter polls").textContent()))
    .toBeGreaterThan(0);
  const framesAfterPoll = Number(await page.getByLabel("Recorded frames").textContent());
  await expect
    .poll(async () => Number(await page.getByLabel("Recorded frames").textContent()))
    .toBeGreaterThan(Math.max(2, framesAfterPoll));
  await page.getByRole("button", { name: "Stop recording" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export recording" }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(download.suggestedFilename()).toBe("jank-recording.json");
  if (!path) {
    throw new Error("Download failed");
  }
  const result = parseRecording(await readFile(path, "utf8"));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.problem.message);
  }
  expect(result.recording.frames.length).toBeGreaterThan(2);
  expect(result.recording.frames.some((frame) => frame.scopes.length > 0)).toBe(true);
  expect(result.recording.counters.some((sample) => sample.status === "ready")).toBe(true);
});

test("real host frames collect scopes; disposing the collector leaves the host loop running", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/fixtures/collection/");
  await expect(page.getByLabel("Sealed frames")).toHaveText(/[1-9]\d*/);
  await expect(page.getByLabel("Scope intervals")).toHaveText(/[1-9]\d*/);
  const firstFrameId = Number(await page.getByLabel("Latest frame ID").textContent());
  await page.getByRole("button", { name: "Clear history" }).click();
  await expect
    .poll(async () => Number(await page.getByLabel("Latest frame ID").textContent()))
    .toBeGreaterThan(firstFrameId);
  await page.getByRole("button", { name: "Dispose collector" }).click();
  await expect(page.getByLabel("Sealed frames")).toHaveText("0");
  const hostFrame = Number(await page.getByLabel("Host frames").textContent());
  await expect
    .poll(async () => Number(await page.getByLabel("Host frames").textContent()))
    .toBeGreaterThan(hostFrame + 2);
  await expect(page.getByLabel("Sealed frames")).toHaveText("0");
  await expect(page.getByLabel("Scope intervals")).toHaveText("0");
  expect(errors).toEqual([]);
});
