import { expect, test } from "@playwright/test";
import { recordingFixture } from "../src/recording/fixtures.ts";

for (const theme of ["dark", "light"]) {
  test(`recording-wide summary, ranked markers, capture phases and coverage evidence in ${theme}`, async ({
    page,
  }, info) => {
    await page.goto(`/checks/viewer.html?theme=${theme}`);
    const summary = page.locator('dl[aria-label="Recording summary"]');
    await expect(summary.locator(":scope > div")).toHaveCount(5);
    await expect(summary).toContainText("74.4%");
    await page.getByRole("tab", { name: "Captures", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Capture window details", exact: true }),
    ).toContainText("Before context: 242 of 300 requested frames · clipped");
    await expect(
      page.getByRole("region", { name: "Capture window details", exact: true }),
    ).toContainText("After context: 117 of 120 requested frames · clipped");
    await expect(page.getByRole("img", { name: /^Retained capture window:/ })).toHaveAttribute(
      "aria-label",
      /Before onset 242 · Trigger 1 · After 117/,
    );
    const original = await summary.textContent();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: /^Spike 2, frame 1671,/ }).click();
    await expect(page.getByRole("slider", { name: "Selected frame", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "335",
    );
    await expect(page.getByRole("navigation", { name: "Recording navigation" })).toContainText(
      "▲2 of 3",
    );
    await expect(summary).toHaveText(original ?? "");
    const why = page.getByRole("button", { name: "Why?", exact: true });
    const popup = page.getByRole("dialog", { name: "GPU coverage explanation" });
    await why.click();
    await expect(popup.getByRole("img")).toHaveAttribute(
      "aria-label",
      "268 complete · 2 partial · 0 unknown · 90 missing GPU frame records",
    );
    await info.attach(`GPU coverage ${theme}`, {
      body: await popup.screenshot(),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(popup).toBeHidden();
    await expect(why).toBeFocused();
    await why.click();
    await popup.getByRole("button", { name: "Close GPU coverage" }).click();
    await expect(why).toBeFocused();
    await why.click();
    await page.getByRole("heading", { name: "Recording viewer", exact: true }).click();
    await expect(popup).toBeHidden();
    await why.click();
    await popup.getByRole("button", { name: /^f1485 · incomplete/ }).click();
    const evidence = page.getByRole("region", { name: "Selected frame GPU evidence" });
    await expect(evidence).toBeFocused();
    await expect(evidence).toContainText("GPU counter reset");
    await expect(popup).toBeHidden();
    await info.attach(`Recording summary ${theme}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.goto(`/checks/viewer.html?episode&theme=${theme}`);
    await expect(page.getByRole("img", { name: /^Retained capture window:/ })).toHaveAttribute(
      "aria-label",
      /Before onset 238 · Qualifying 4 · Episode 109 · After 9/,
    );
    await page.getByRole("tab", { name: "Captures", exact: true }).click();
    await expect(page.getByRole("region", { name: "Automatic capture context" })).toContainText(
      "Quiet recovery reached",
    );
  });
}

test("mixed/legacy/missing evidence keeps honest counts and native popover focus", async ({
  page,
}) => {
  await page.goto("/checks/viewer.html?mixed");
  const why = page.getByRole("button", { name: "Why?", exact: true });
  const popup = page.getByRole("dialog", { name: "GPU coverage explanation" });
  await why.click();
  await expect(popup.getByRole("img")).toHaveAttribute(
    "aria-label",
    "266 complete · 3 partial · 1 unknown · 90 missing GPU frame records",
  );
  await popup.getByRole("button", { name: /^f1005 · incomplete/ }).click();
  await page.getByRole("button", { name: /Why this coverage/ }).click();
  await expect(
    page.getByText(/2 additional invocations omitted beyond record capacity/),
  ).toBeVisible();
  const legacy = recordingFixture(4);
  legacy.gpu = { units: "milliseconds", measurement: "legacy span", latest: null, samples: [] };
  const file = page.getByLabel("Open recording or comparison file");
  await file.setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await why.click();
  await expect(popup.getByRole("img")).toHaveAttribute(
    "aria-label",
    "0 complete · 0 partial · 4 unknown · 0 missing GPU frame records",
  );
  await expect(popup).toContainText(
    "Legacy summaries cannot establish per-frame invocation coverage",
  );
  await file.setInputFiles({
    name: "empty.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recordingFixture(0))),
  });
  await expect(popup).toBeHidden();
  await why.click();
  await expect(popup.getByRole("img")).toHaveAttribute(
    "aria-label",
    "0 complete · 0 partial · 0 unknown · 0 missing GPU frame records",
  );
  await expect(popup).toContainText("No GPU evidence was supplied");
});

test("dense recordings bound marker labels and paginate problem records", async ({ page }) => {
  await page.goto("/checks/viewer.html?large&dense&many-failures");
  const markers = page.getByRole("group", { name: "Ranked spike markers" });
  await expect(markers.getByRole("button")).toHaveCount(3);
  const boxes = await markers.getByRole("button").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }),
  );
  expect(boxes[0]?.bottom).toBeLessThanOrEqual(boxes[1]?.top ?? 0);
  expect(boxes[1]?.bottom).toBeLessThanOrEqual(boxes[2]?.top ?? 0);
  await page.getByRole("slider", { name: "Selected frame", exact: true }).press("End");
  await expect(markers.getByRole("button")).toHaveCount(4);
  await page.getByRole("button", { name: "Why?", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "GPU coverage explanation" });
  await expect(popup.getByRole("listitem")).toHaveCount(20);
  await expect(popup).toContainText("4500 frames");
  const first = await popup.getByRole("listitem").first().textContent();
  await popup.getByRole("button", { name: "Next causes", exact: true }).click();
  await expect(popup.getByRole("listitem")).toHaveCount(20);
  expect(await popup.getByRole("listitem").first().textContent()).not.toBe(first);
});
