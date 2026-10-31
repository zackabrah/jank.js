import { expect, test } from "@playwright/test";

test("loading promises retain their run across replacement in a browser host", async ({ page }) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  const result = await page.evaluate(async () => {
    const path = "/packages/jank/src/index.ts";
    const { createLoadingProfiler }: typeof import("../../packages/jank/src/index.ts") =
      await import(path);
    const loading = createLoadingProfiler();
    const first = loading.beginRun({ label: "First", kind: "fresh-context" });
    let resolve: (value: number) => void = () => {};
    const pending = first.measure(
      "fetch",
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    const second = loading.beginRun({ label: "Second", kind: "repeat-session" });
    resolve(42);
    const value = await pending;
    second.finish("ready");
    const result = { value, history: loading.history(), baseline: loading.baseline() };
    loading.dispose();
    return result;
  });
  expect(result.value).toBe(42);
  expect(result.history).toMatchObject([
    { status: "cancelled", pendingOperations: 1, stages: [{ name: "fetch" }] },
    { status: "ready", pendingOperations: 0, stages: [] },
  ]);
  expect(result.baseline).toBeNull();
});
