import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("timestamp diagnostic runs only on request and exports its raw evidence", async ({
  page,
}, testInfo) => {
  await page.goto("/examples/gpu-diagnostic/");
  await expect(page.getByRole("status")).toHaveText("Ready. No GPU work has been submitted.");
  await expect(page.getByRole("button", { name: "Download report" })).toBeDisabled();
  await page.getByRole("button", { name: "Run timestamp diagnostic" }).click();
  await expect(page.getByRole("button", { name: "Run timestamp diagnostic" })).toBeEnabled({
    timeout: 25000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const report = JSON.parse(Buffer.concat(chunks).toString());
  await testInfo.attach("timestamp-diagnostic.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  test.skip(report.probe.status === "unsupported", "Hardware timestamp queries unavailable");
  expect(report.gpuErrors).toEqual([]);
  expect(report.probe.status).toBe("finished");
  expect(report.probe.pairs).toHaveLength(6);
  await expect(page.getByRole("row")).toHaveCount(7);
  for (const pair of report.probe.pairs) {
    expect(pair.startNs).toMatch(/^\d+$/);
    expect(pair.endNs).toMatch(/^\d+$/);
    if (pair.reason) {
      expect(pair.durationMs).toBeNull();
    }
  }
});
