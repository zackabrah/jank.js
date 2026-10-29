import { expect, test } from "@playwright/test";

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
