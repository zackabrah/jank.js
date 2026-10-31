import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { parseRecording } from "../../packages/jank/src/index.ts";

test("capture coverage shows known losses, missing frames and capacity without changing on freeze", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(async () => {
    const fixturePath = "/tests/fixtures/gpu-sample.ts";
    const { gpuIntervalFixture }: typeof import("../fixtures/gpu-sample.ts") = await import(
      fixturePath
    );
    const { profiler } = window.panelFixture;
    profiler.clear();
    profiler.capture.start();
    window.panelFixture.advance(3);
    const frames = profiler.snapshot().frames;
    for (const [index, frame] of frames.entries()) {
      if (index > 1) {
        break;
      }
      const sample = { ...gpuIntervalFixture(), sequence: index + 1, frameId: frame.id };
      profiler.observeGpu({
        status: "ready",
        currentRendererFrameId: 8,
        droppedSamples: 0,
        sample:
          index === 0
            ? sample
            : {
                ...sample,
                passes: [],
                completeness: "incomplete",
                metrics: null,
                omittedPasses: 3,
                issues: ["retention-capacity"],
              },
      });
    }
  });
  await page.getByRole("button", { name: "FREEZE", exact: true }).click();
  await expect(page.locator('[data-value="capture-health"]')).toContainText(
    "GPU interval coverage",
  );
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.locator('[data-value="capture-progress"]')).toContainText(
    "retention-capacity: 1",
  );
  await expect(page.locator('[data-value="capture-capacity"]')).toContainText("GPU retention pool");
  const progress = await page.evaluate(() => window.panelFixture.profiler.capture.getProgress());
  expect(progress.gpu.completeFrames).toBe(1);
  expect(progress.gpu.incompleteFrames).toBe(1);
  await page.evaluate(() => window.panelFixture.profiler.capture.stop());
  await page.getByRole("tab", { name: "LIVE", exact: true }).click();
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  await expect(page.locator(".jank-capture")).toContainText("retention-capacity: 1");
  expect((await new AxeBuilder({ page }).include(".jank").analyze()).violations).toEqual([]);
});

test("scope rows keep registration order as timing and sample order change", async ({ page }) => {
  await page.goto("/tests/fixtures/panel/?mode=full");
  const orders = await page.evaluate(async () => {
    const modulePath = "/packages/jank/src/index.ts";
    const { createPanel, createProfiler }: typeof import("../../packages/jank/src/index.ts") =
      await import(modulePath);
    window.panelFixture.panel.dispose();
    let timeMs = 0;
    const profiler = createProfiler({ now: () => timeMs });
    const first = profiler.createChannel({ id: "first", label: "zeta" });
    const second = profiler.createChannel({ id: "second", label: "alpha" });
    profiler.createChannel({
      id: "counters",
      label: "Counters only",
      readCounters: () => ({ n: 1 }),
    });
    const panel = createPanel({ container: document.body, profiler, mode: "full" });
    const orders: string[][] = [];
    for (const sequence of [
      [second, first],
      [first, second],
    ]) {
      // Replace the entire rolling history so its first observed scope changes.
      for (let frame = 0; frame < 601; frame += 1) {
        const startedAtMs = timeMs;
        profiler.beginFrame(timeMs);
        for (const [index, channel] of sequence.entries()) {
          const token = channel.begin();
          timeMs += index + 1;
          channel.end(token);
        }
        timeMs = startedAtMs + 16;
      }
      profiler.beginFrame(timeMs);
      panel.refresh(timeMs);
      orders.push(
        Array.from(
          document.querySelectorAll('[data-list="scopes"] .jank-row > :first-child'),
          (label) => label.textContent ?? "",
        ),
      );
    }
    panel.dispose();
    profiler.dispose();
    return orders;
  });
  expect(orders).toEqual([
    ["zeta", "alpha", "unattributed"],
    ["zeta", "alpha", "unattributed"],
  ]);
});

test("counter labels and values stay on one line when details need a scrollbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => {
    window.panelFixture.profiler.createChannel({
      id: "renderer",
      label: "render submit",
      readCounters: () => ({ objects: 256, draws: 257, triangles: 3072 }),
    });
    window.panelFixture.advance(70);
  });
  const details = page.getByRole("region", { name: "Performance details" });
  const widthBefore = await details.evaluate((region) => region.clientWidth);
  await page.setViewportSize({ width: 960, height: 560 });
  expect(await details.evaluate((region) => region.scrollHeight > region.clientHeight)).toBe(true);
  expect(await details.evaluate((region) => region.clientWidth)).toBe(widthBefore);
  for (const width of [960, 360]) {
    await page.setViewportSize({ width, height: 560 });
    const counters = page.locator('[data-list="counters"]');
    await counters.scrollIntoViewIfNeeded();
    const sizes = await counters.locator(".jank-row").evaluateAll((rows) =>
      rows.map((row) => ({
        height: row.getBoundingClientRect().height,
        overflow: row.scrollWidth > row.clientWidth,
      })),
    );
    expect(sizes).toHaveLength(5);
    for (const size of sizes) {
      expect(size.height).toBeLessThanOrEqual(20);
      expect(size.overflow).toBe(false);
    }
  }
});

test("LIVE keeps its summary pinned while details scroll from CPU scopes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(() => window.panelFixture.advance(70));
  const metrics = page.locator('[data-tabpanel="live"] .jank-metrics');
  const chart = page.locator(".jank-chart");
  const scopes = page.getByRole("heading", { name: "CPU SCOPES MS / FRAME" });
  const metricBefore = await metrics.boundingBox();
  const chartBefore = await chart.boundingBox();
  const automatic = page.locator(".jank-automatic-live");
  const automaticBefore = await automatic.boundingBox();
  const scopesBefore = await scopes.boundingBox();
  const scroll = page.getByRole("region", { name: "Performance details" });
  await scopes.hover();
  await page.mouse.wheel(0, 300);
  // wheel() returns before native scrolling finishes; Home must not race the pending motion.
  let previousTop = -1;
  let stableReads = 0;
  await expect
    .poll(async () => {
      const top = await scroll.evaluate((node) => node.scrollTop);
      stableReads = top > 0 && top === previousTop ? stableReads + 1 : 0;
      previousTop = top;
      return stableReads;
    })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(async () => (await scopes.boundingBox())?.y ?? Infinity)
    .toBeLessThan(scopesBefore?.y ?? 0);
  expect(await metrics.boundingBox()).toEqual(metricBefore);
  expect(await chart.boundingBox()).toEqual(chartBefore);
  await expect(scroll).toBeVisible();
  expect(await automatic.boundingBox()).toEqual(automaticBefore);
  expect((await scroll.boundingBox())?.y).toBeCloseTo(
    (automaticBefore?.y ?? 0) + (automaticBefore?.height ?? 0),
    0,
  );
  await scroll.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.locator(".jank-overhead")).toBeInViewport();
});

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
