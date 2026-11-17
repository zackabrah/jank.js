import { expect, test } from "@playwright/test";
import "../src/agent/api.ts";

test("an agent records a real host through window.jank and finds an injected spike", async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/checks/three.html?backend=webgl2");
  await page.waitForFunction(() => window.jank?.version === 1);
  await page.evaluate(() => window.jank?.start());
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Inject 80 ms CPU spike" }).click();
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => window.jank?.stop());
  if (!result) throw new Error("window.jank.stop returned nothing.");
  const { id, report } = result;

  expect(report.summary.frames).toBeGreaterThan(10);
  const spike = report.episodes.find((episode) => (episode.scopes[0]?.ms ?? 0) >= 80);
  // Spike or stall depends on what else slowed nearby frames, so the unit tests pin the labels.
  expect(spike?.scopes[0]?.label).toBe("CPU simulation");
  const labels = spike?.events.map((event) => event.label);
  expect(labels).toContain("CPU spike");
  // Long frames come from the long-animation-frame API, which only Chromium has.
  if (browserName === "chromium") expect(labels).toContain("Long frame");

  const status = await page.evaluate(() => window.jank?.status());
  expect(status?.captures.map((capture) => capture.id)).toEqual([id]);
  const exported = await page.evaluate(() => window.jank?.export());
  expect(JSON.parse(exported ?? "{}").frames).toHaveLength(report.summary.frames);
  expect(errors).toEqual([]);
});
