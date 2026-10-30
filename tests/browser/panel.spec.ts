import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";

test("built JavaScript and CSS mount without loading either package's source files", async ({
  page,
}) => {
  const sourceRequests: string[] = [];
  await page.route(/\/packages\/(jank|junkui)\/src\//u, (route) => {
    sourceRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/tests/fixtures/panel/built.html");
  await expect(page.locator(".jank")).toHaveCSS("width", "360px");
  await expect(page.locator('[data-value="average"]')).toHaveText("16.7");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export capture 1" })).toBeVisible();
  expect(sourceRequests).toEqual([]);
});

test("LINE uses sealed history and preserves the compact dimensions", async ({ page }) => {
  await page.goto("/tests/fixtures/panel/");
  const panel = page.getByRole("complementary", { name: "jank.js performance" });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await expect(panel).toHaveAttribute("data-mode", "line");
  await expect(panel).toHaveCSS("width", "360px");
  await expect(panel).toHaveCSS("height", "28px");
  await expect(panel.locator('[data-value="line-fps"]')).toHaveText("–");
  await page.evaluate(() => window.panelFixture.advance(70));
  await expect(panel.locator('[data-value="line-fps"]')).toHaveText("60");
  await expect(panel.locator('[data-value="line-average"]')).toHaveText("16.7");
  await page.evaluate(() => {
    window.panelFixture.profiler.capture.start();
    window.panelFixture.refresh();
  });
  await expect(panel.locator('[data-value="line-recording"]')).toHaveText("REC");
  await expect(page.locator("#host-content")).toHaveText("Host-owned content");
});

test("a panel releases only its own scope request and preserves keyboard interaction", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.profiler.requestScopes();
    window.panelFixture.panel.setMode("line");
    window.panelFixture.advance(2);
  });
  expect(
    await page.evaluate(
      () => window.panelFixture.profiler.snapshot().frames.at(-1)?.coverage.status,
    ),
  ).toBe("complete");
  await page.getByRole("button", { name: "Open full panel" }).click();
  await page.getByRole("tab", { name: "LIVE", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "LOADING", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "CAPTURE", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "TRACE", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("trace sink");
  await expect(page.getByRole("button", { name: "TRACE", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("failed exports report an error without damaging captured data", async ({ page }) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => window.panelFixture.advance(3));
  await page.getByRole("button", { name: "STOP REC", exact: true }).click();
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error("Downloads unavailable");
    };
  });
  await page.getByRole("button", { name: "EXPORT JSON", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Downloads unavailable");
  expect(
    await page.evaluate(() => window.panelFixture.profiler.capture.read(1)?.frames.length),
  ).toBe(3);
});

test("optional GPU controls operate the borrowed source and show unavailable data explicitly", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(async () => {
    const modulePath = "/packages/jank/src/index.ts";
    const { createPanel }: typeof import("../../packages/jank/src/index.ts") = await import(
      modulePath
    );
    const profiler = window.panelFixture.profiler;
    let state: import("../../packages/jank/src/index.ts").GpuState = { status: "disabled" };
    window.panelFixture.panel.dispose();
    window.panelFixture.panel = createPanel({
      container: document.body,
      profiler,
      mode: "full",
      gpu: {
        label: "Test GPU",
        read: () => state,
        setEnabled: (enabled) => {
          state = enabled ? { status: "pending" } : { status: "disabled" };
          profiler.observeGpu(state);
        },
      },
    });
  });
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByRole("button", { name: "Enable GPU timing" }).click();
  await expect(page.getByRole("button", { name: "Disable GPU timing" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await expect(page.locator('[data-value="gpu-note"]')).toHaveText("pending");
  await expect(page.locator('[data-list="gpu"]')).toContainText("–");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByRole("button", { name: "Disable GPU timing" }).click();
  expect(await page.evaluate(() => window.panelFixture.profiler.snapshot().gpu?.status)).toBe(
    "disabled",
  );
});

test("refresh is host-driven and throttled, and invalid modes leave the mounted view intact", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => window.panelFixture.advance(1));
  await expect(page.locator('[data-value="average"]')).toHaveText("–");
  await page.evaluate(() => window.panelFixture.advance(6));
  await expect(page.locator('[data-value="average"]')).toHaveText("16.7");
  expect(
    await page.evaluate(() => {
      try {
        Reflect.apply(window.panelFixture.panel.setMode, null, ["invalid"]);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }),
  ).toContain("mode");
  await expect(page.locator(".jank")).toHaveAttribute("data-mode", "full");
});

test("modes retain focus, hold independent scope demand and remember the chosen size", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/");
  await page.getByRole("button", { name: "Open full panel", exact: true }).click();
  const panel = page.locator(".jank");
  await expect(panel).toHaveAttribute("data-mode", "full");
  await expect(page.getByRole("button", { name: "Shrink to mini view" })).toBeFocused();
  await page.evaluate(() => window.panelFixture.advance(70));
  expect(
    await page.evaluate(
      () => window.panelFixture.profiler.snapshot().frames.at(-1)?.coverage.status,
    ),
  ).toBe("complete");
  await page.getByRole("button", { name: "Shrink to mini view" }).click();
  await expect(panel).toHaveCSS("width", "240px");
  await expect(page.getByRole("button", { name: "Expand to full panel" })).toBeFocused();
  await page.getByRole("button", { name: "Collapse to one line" }).click();
  await expect(panel).toHaveAttribute("data-mode", "line");
  await page.evaluate(() => window.panelFixture.advance(2));
  expect(
    await page.evaluate(
      () => window.panelFixture.profiler.snapshot().frames.at(-1)?.coverage.status,
    ),
  ).toBe("not-collected");
  await page.reload();
  await expect(page.locator(".jank")).toHaveAttribute("data-mode", "line");
});

test("FULL freezes presentation while recording continues and exports a valid file", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => window.panelFixture.advance(70));
  const average = page.locator('[data-value="average"]');
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.getByRole("button", { name: "FREEZE", exact: true }).click();
  const before = await average.textContent();
  await page.evaluate(() => window.panelFixture.advance(20, 40));
  await expect(average).toHaveText(before ?? "");
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState())).toMatchObject({
    status: "manual",
    recordedFrames: 20,
  });
  await page.getByRole("button", { name: "RESUME", exact: true }).click();
  expect(await average.textContent()).not.toBe(before);
  await page.getByRole("button", { name: "STOP REC", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "EXPORT JSON", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) {
    throw new Error("Missing recording download");
  }
  const result = parseRecording(await readFile(path, "utf8"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.recording.frames).toHaveLength(20);
  }
});

test("CAPTURE validates labelled settings and keeps completed captures outside panel ownership", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await page.getByLabel("Threshold ms", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Arm automatic capture" }).click();
  await expect(page.getByRole("alert")).toContainText("positive");
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState().status)).toBe(
    "idle",
  );
  await page.getByLabel("Threshold ms", { exact: true }).fill("30");
  await page.getByLabel("Before frames", { exact: true }).fill("2");
  await page.getByLabel("After frames", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Arm automatic capture" }).click();
  await page.evaluate(() => {
    window.panelFixture.advance(5);
    window.panelFixture.advance(1, 40);
    window.panelFixture.advance(3);
    window.panelFixture.refresh();
  });
  await expect(page.getByRole("button", { name: "Export capture 1" })).toBeVisible();
  await expect(page.locator(".jank-capture canvas")).toHaveAttribute(
    "aria-label",
    /1 above budget/u,
  );
  await page.evaluate(() => {
    window.panelFixture.panel.dispose();
    window.panelFixture.panel.dispose();
  });
  await expect(page.locator(".jank")).toHaveCount(0);
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.completed().length)).toBe(
    1,
  );
  await page.evaluate(() => window.panelFixture.mount("full"));
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export capture 1" })).toBeVisible();
});

test("disposal leaves capture and the host usable; unavailable storage does not prevent mounting", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.getByRole("button", { name: "REC", exact: true }).click();
  await page.evaluate(() => {
    window.panelFixture.panel.dispose();
    window.panelFixture.advance(10);
    window.panelFixture.panel.setMode("mini");
  });
  await expect(page.locator(".jank")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.panelFixture.profiler.capture.stop()?.frames.length),
  ).toBe(10);
  await expect(page.locator("#host-content")).toBeVisible();
});

test("untrusted labels stay text and every visible mode passes accessibility checks", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.profiler.addEvent('<img src=x onerror="alert(1)">');
    window.panelFixture.advance(70);
  });
  await expect(page.locator(".jank img")).toHaveCount(0);
  for (const name of ["LIVE", "LOADING", "CAPTURE"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Shrink to mini view" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Collapse to one line" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
