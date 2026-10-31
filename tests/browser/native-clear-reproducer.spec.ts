import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

test("upstream reproducer runs native passes without framework imports", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") {
      external.push(request.url());
    }
  });
  await page.goto(
    pathToFileURL(resolve("docs/verification/webgpu-clear-only-reproducer.html")).href,
  );
  await page.getByRole("button", { name: "Run native probe" }).click();
  await expect(page.getByRole("button", { name: "Download evidence" })).toBeEnabled({
    timeout: 25000,
  });
  const result = JSON.parse((await page.locator("#evidence").textContent()) ?? "");
  await testInfo.attach("native-clear-only.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(external).toEqual([]);
  test.skip(result.status === "unsupported", "WebGPU timestamps unavailable");
  expect(result.status).toBe("finished");
  expect(result.errors).toEqual([]);
  expect(result.pairs.map((pair: { draw: boolean }) => pair.draw)).toEqual([
    true,
    false,
    false,
    true,
    false,
    true,
  ]);
  expect(result.pairs).toHaveLength(6);
});
