import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { parseComparison } from "../src/compare/model.ts";
import { comparisonResults } from "../src/compare/results.ts";
import { parseRecording } from "../src/recording/format.ts";

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${backend} stress controls, CPU scopes and frame-linked GPU capture`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      const counts = { scopes: 0, markers: 0 };
      Reflect.set(window, "jankTraceCounts", counts);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.name.startsWith("jank.js:")) continue;
          if (entry.entryType === "measure") counts.scopes++;
          else counts.markers++;
        }
      }).observe({ entryTypes: ["mark", "measure"] });
    });
    await page.goto(`/checks/three.html?backend=${backend}`);
    const controls = page.getByRole("button", { name: "Baseline", exact: true });
    await expect
      .poll(async () => (await controls.isEnabled()) || (await page.getByRole("alert").count()) > 0)
      .toBe(true);
    if (await page.getByRole("alert").count()) {
      expect(
        info.project.name,
        "The native GPU run requires working hardware, not an unsupported-state pass.",
      ).not.toBe("chrome-gpu");
      expect(backend).toBe("webgpu");
      await expect(page.getByRole("alert")).toContainText(
        /WebGPU.*(not available|no available GPU adapter)/,
      );
      await expect(controls).toBeDisabled();
      expect(errors).toEqual([]);
      return;
    }
    const metrics = page.locator('[aria-label="Scene statistics"] dd');
    await expect
      .poll(async () => Number((await metrics.nth(2).textContent())?.replaceAll(",", "")))
      .toBeGreaterThan(0);
    if (info.project.name === "chrome-gpu")
      await expect(
        page.getByRole("status").filter({ hasText: /[1-9]\d*\/[1-9]\d* GPU passes timed/ }),
      ).toBeVisible();
    const panel = page.getByRole("complementary", { name: "Live Jank panel" });
    await panel.getByRole("button", { name: /^Counters/ }).click();
    const counters = panel.locator('dl[aria-label="Render submission counters"]');
    const counter = (label: string) =>
      counters
        .locator("div")
        .filter({ has: page.getByText(label, { exact: true }) })
        .locator("dd");
    const count = async (label: string) =>
      Number((await counter(label).textContent())?.replaceAll(",", ""));
    await expect.poll(() => count("Draw Calls")).toBeGreaterThan(0);
    const baselineCalls = await count("Draw Calls");
    await expect.poll(() => count("Lines")).toBeGreaterThan(0);
    await expect.poll(() => count("Geometries")).toBeGreaterThan(0);
    await expect(counter("Points")).toHaveText("0");
    await expect(counter("Compute Calls")).toHaveText(backend === "webgpu" ? "0" : "Unavailable");
    await expect(counter(backend === "webgpu" ? "Programs" : "Shader Stages")).toHaveText(
      "Unavailable",
    );
    await expect
      .poll(() => count(backend === "webgpu" ? "Shader Stages" : "Programs"))
      .toBeGreaterThan(0);
    if (backend === "webgpu")
      await expect(counter("Tracked Storage Estimate")).toHaveText(/[1-9].* (?:B|KiB|MiB)/);
    else await expect(counter("Tracked Storage Estimate")).toHaveText("Unavailable");
    await expect(counter("Configured Instances")).toHaveText("144");
    await expect(counter("Active Instances")).toHaveText("144");
    await expect(counter("Instance Capacity")).toHaveText("2,048");
    await expect(counter("Unique Submitted Instances")).toHaveText("144");
    await expect(counter("Submitted Instances")).toHaveText("144");
    await expect(counter("Instance Draw Calls")).toHaveText("1");
    await expect(counter("Visible Instances")).toHaveText("Unavailable");
    await expect(counter("Frustum Culling Enabled")).toHaveText("No");
    await expect(counter("Temporal Enabled")).toHaveText("No");
    await expect(counter("Temporal History Valid")).toHaveText("Unavailable");
    await expect(counter("Temporal History Age Frames")).toHaveText("Unavailable");
    await info.attach(`${backend} scene`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "CPU stress", exact: true }).click();
    await expect
      .poll(async () => Number.parseFloat((await metrics.nth(0).textContent()) ?? "0"))
      .toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: "GPU stress", exact: true }).click();
    await expect(page.getByRole("slider", { name: "GPU scene repeats" })).toHaveValue("4");
    await expect
      .poll(async () => Number((await metrics.nth(2).textContent())?.replaceAll(",", "")))
      .toBeGreaterThanOrEqual(8);
    await expect.poll(() => count("Draw Calls")).toBeGreaterThanOrEqual(baselineCalls * 4);
    await expect(counter("Passes")).toHaveText("4");
    await expect(counter("Unique Submitted Instances")).toHaveText("1,024");
    await expect(counter("Submitted Instances")).toHaveText("4,096");
    await expect(counter("Instance Draw Calls")).toHaveText("4");
    const visibility = page.getByRole("checkbox", { name: "Show instanced mesh", exact: true });
    await visibility.uncheck();
    await expect(counter("Mesh Visible")).toHaveText("No");
    await expect(counter("Submitted Instances")).toHaveText("0");
    await expect(counter("Unique Submitted Instances")).toHaveText("0");
    await expect(counter("Configured Instances")).toHaveText("1,024");
    await expect(counter("Active Instances")).toHaveText("1,024");
    await expect.poll(() => count("Draw Calls")).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Baseline", exact: true }).click();
    await expect(visibility).toBeChecked();
    await expect(counter("Active Instances")).toHaveText("144");
    await expect(counter("Mesh Visible")).toHaveText("Yes");
    await page.getByRole("button", { name: "Pause workload", exact: true }).click();
    await expect(metrics.nth(2)).toHaveText("0");
    await expect(metrics.nth(0)).toHaveText("0.00 ms");
    await expect(counter("Workload Paused")).toHaveText("Yes");
    for (const label of ["Draw Calls", "Triangles", "Lines", "Passes"])
      await expect(counter(label)).toHaveText("0");
    await expect.poll(() => count("Geometries")).toBeGreaterThan(0);
    await expect(counter("Submitted Instances")).toHaveText("0");
    await expect(counter("Unique Submitted Instances")).toHaveText("0");
    await page.getByRole("slider", { name: "Configured instances", exact: true }).press("Home");
    await expect(counter("Configured Instances")).toHaveText("1");
    await expect(counter("Active Instances")).toHaveText("144");
    await page.getByRole("button", { name: "Resume workload", exact: true }).click();
    await expect(counter("Workload Paused")).toHaveText("No");
    await expect(counter("Active Instances")).toHaveText("1");
    await expect(counter("Submitted Instances")).toHaveText("1");
    await page.getByRole("button", { name: "Baseline", exact: true }).click();
    await expect(counter("Active Instances")).toHaveText("144");
    await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
    const gpuSwitch = panel.getByRole("switch", { name: "GPU timing", exact: true });
    const timing = page.getByRole("checkbox", { name: "GPU timing probes", exact: true });
    if (await timing.isEnabled()) {
      await timing.uncheck();
      await expect(
        page.getByRole("status").filter({ hasText: /^GPU timing disabled$/ }),
      ).toBeVisible();
      await expect(gpuSwitch).not.toBeChecked();
      await gpuSwitch.click();
      await expect(timing).toBeChecked();
      await expect(
        page.getByRole("status").filter({ hasText: /[1-9]\d*\/[1-9]\d* GPU passes timed/ }),
      ).toBeVisible();
    } else {
      await expect(gpuSwitch).toBeDisabled();
      await expect(gpuSwitch).toHaveAccessibleDescription(
        "This renderer has no GPU timestamp query support.",
      );
    }
    const trace = panel.getByRole("switch", { name: "Trace events", exact: true });
    const counts = () =>
      page.evaluate(
        () => Reflect.get(window, "jankTraceCounts") as { scopes: number; markers: number },
      );
    expect((await counts()).scopes).toBe(0);
    await trace.click();
    await expect(trace).toBeChecked();
    await expect.poll(async () => (await counts()).scopes).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Baseline", exact: true }).click();
    await expect.poll(async () => (await counts()).markers).toBeGreaterThan(0);
    await trace.click();
    await expect(trace).not.toBeChecked();
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 3; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    await settle();
    const off = await counts();
    await settle();
    expect(await counts()).toEqual(off);
    await panel.getByRole("button", { name: "Start recording", exact: true }).click();
    await page.getByRole("button", { name: "Inject 80 ms CPU spike", exact: true }).click();
    await expect
      .poll(async () =>
        Number(
          await panel
            .getByRole("progressbar", { name: "Recording capacity", exact: true })
            .getAttribute("aria-valuenow"),
        ),
      )
      .toBeGreaterThan(5);
    await expect(panel.getByText(/Recording GPU coverage unavailable/)).toHaveCount(0);
    await panel.getByRole("tab", { name: "Live", exact: true }).click();
    await expect(
      panel.getByRole("slider", { name: "Inspect events", exact: true }),
    ).toHaveAttribute("aria-valuetext", /CPU spike.*80 ms synthetic workload queued/);
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await panel.getByRole("button", { name: /^Events/ }).click();
    const events = panel.getByRole("list", { name: "Recent events", exact: true });
    await expect(events).toContainText("80 ms synthetic workload queued");
    await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
    await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
    await expect(panel.getByRole("listitem", { name: "Capture C1", exact: true })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await panel
      .getByRole("listitem", { name: "Capture C1", exact: true })
      .getByRole("button", { name: "Export capture C1", exact: true })
      .click();
    const path = await (await downloading).path();
    if (!path) throw new Error("Missing scene recording export");
    const recording = parseRecording(await readFile(path, "utf8"));
    expect(recording.systems.find((system) => system.id === "submission")?.values).toMatchObject({
      backend,
      frameId: expect.any(Number),
      widthPx: expect.any(Number),
      heightPx: expect.any(Number),
      workloadPaused: false,
      points: 0,
      computeCalls: backend === "webgpu" ? 0 : null,
      configuredInstances: 144,
      activeInstances: 144,
      uniqueSubmittedInstances: 144,
      submittedInstances: 144,
      meshVisible: true,
      visibleInstances: null,
    });
    expect(recording.samples.length).toBeGreaterThan(0);
    for (const sample of recording.samples) {
      const frame = recording.frames.find((item) => item.at === sample.at);
      expect(frame, "Counter samples must correspond to a captured frame").toBeDefined();
      expect(sample.systems.find((system) => system.id === "submission")?.values).toMatchObject({
        frameId: frame?.id,
        backend,
        drawCalls: expect.any(Number),
        trackedStorageEstimateBytes: backend === "webgpu" ? expect.any(Number) : null,
        configuredInstances: 144,
        uniqueSubmittedInstances: 144,
        submittedInstances: 144,
        visibleInstances: null,
      });
    }
    expect(recording.events).toContainEqual(
      expect.objectContaining({
        label: "CPU spike",
        detail: "80 ms synthetic workload queued",
      }),
    );
    expect(recording.frames.some((frame) => frame.interval >= 65)).toBe(true);
    expect(
      recording.frames.some((frame) => frame.scopes.some((scope) => scope.system === "simulation")),
    ).toBe(true);
    expect(
      recording.frames.some((frame) => frame.scopes.some((scope) => scope.system === "submission")),
    ).toBe(true);
    expect(recording.gpuTiming?.frames.map((frame) => frame.frameId)).toEqual(
      recording.frames.map((frame) => frame.id),
    );
    expect(recording.gpuTiming?.frames.every((frame) => frame.source === backend)).toBe(true);
    if (info.project.name === "chrome-gpu")
      expect(
        recording.gpuTiming?.frames.some((frame) =>
          frame.invocations.some((pass) => pass.state === "timed" && pass.milliseconds !== null),
        ),
      ).toBe(true);
    await info.attach(`${backend} recording`, {
      body: JSON.stringify(recording),
      contentType: "application/json",
    });
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    if (backend === "webgl2") {
      await page.locator("canvas").evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing scene canvas");
        canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
      });
      await expect(page.getByRole("alert")).toContainText("WebGL context lost");
      await expect(panel.getByRole("listitem", { name: "Capture C1", exact: true })).toBeVisible();
      await expect(gpuSwitch).toBeDisabled();
      await expect(gpuSwitch).toHaveAccessibleDescription(
        "The renderer has stopped. Reload to change GPU timing.",
      );
      await panel.getByRole("tab", { name: "Live", exact: true }).click();
      const failure = events.getByRole("listitem").filter({ hasText: "Renderer failure" });
      await expect(failure).toContainText("WebGL context lost");
      await expect(failure).toContainText("no matching frame");
    }
    expect(errors).toEqual([]);
  });
}

test("unavailable WebGPU has an explicit message and never silently starts WebGL", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
  );
  await page.goto("/checks/three.html?backend=webgpu");
  await expect(page.getByRole("alert")).toContainText("WebGPU is not available in this browser");
  await expect(page.getByRole("button", { name: "Baseline", exact: true })).toBeDisabled();
  await expect(page.getByText("WebGPU unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open WebGL2" })).toHaveAttribute("target", "_blank");
});

// Driver messages are shown as reported, and WebKit words its WebGPU errors differently.
for (const [backend, kind, label, chromiumDetail, webkitDetail] of [
  [
    "webgl2",
    "shader",
    "WebGL shader error",
    "JANK_INJECTED_SHADER_ERROR",
    "JANK_INJECTED_SHADER_ERROR",
  ],
  ["webgpu", "shader", "WebGPU backend error", "JANK_INVALID_WGSL", "GPUValidationError"],
  ["webgpu", "validation", "WebGPU scoped error", "usage", "Validation failure"],
] as const) {
  test(`${backend} ${kind} failure saves the active capture and preserves error details`, async ({
    page,
  }, info) => {
    const detail = info.project.name === "webkit" ? webkitDetail : chromiumDetail;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/checks/three.html?backend=${backend}`);
    const controls = page.getByRole("button", { name: "Baseline", exact: true });
    await expect
      .poll(async () => (await controls.isEnabled()) || (await page.getByRole("alert").count()) > 0)
      .toBe(true);
    if (await page.getByRole("alert").count()) {
      expect(info.project.name, "Native error checks require a working GPU").not.toBe("chrome-gpu");
      expect(backend).toBe("webgpu");
      await expect(page.getByRole("alert")).toContainText(
        /WebGPU.*(not available|no available GPU adapter)/,
      );
      return;
    }
    const panel = page.getByRole("complementary", { name: "Live Jank panel" });
    await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
    const start = async () => {
      await panel.getByRole("button", { name: "Start recording", exact: true }).click();
      await expect
        .poll(async () =>
          Number(
            await panel
              .getByRole("progressbar", { name: "Recording capacity", exact: true })
              .getAttribute("aria-valuenow"),
          ),
        )
        .toBeGreaterThan(5);
    };
    await start();
    await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
    const first = panel.getByRole("listitem", { name: "Capture C1", exact: true });
    await expect(first).toBeVisible();
    await start();
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await page.getByRole("button", { name: `Trigger ${kind} error`, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(new RegExp(detail, "i"));
    await expect(controls).toBeDisabled();
    await expect(first).toBeVisible();
    const saved = panel.getByRole("listitem", { name: "Capture C2", exact: true });
    await expect(saved).toBeVisible();
    const downloading = page.waitForEvent("download");
    await saved.getByRole("button", { name: "Export capture C2", exact: true }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error("Missing fault recording");
    const recording = parseRecording(await readFile(path, "utf8"));
    const event = recording.events.find((item) => item.label === label);
    expect(event?.detail).toMatch(new RegExp(detail, "i"));
    expect(event?.detail).toMatch(/Observed near f\d+/);
    expect(event?.at).toBeGreaterThanOrEqual(recording.frames.at(-1)?.at ?? 0);
    if (backend === "webgpu")
      expect(event?.detail).toContain("asynchronous report, source frame unknown");
    await panel.getByRole("button", { name: "Freeze", exact: true }).click();
    await panel.getByRole("tab", { name: "Live", exact: true }).click();
    await panel.getByRole("button", { name: /^Events/ }).click();
    const failure = panel
      .getByRole("list", { name: "Recent events", exact: true })
      .getByRole("listitem")
      .filter({ hasText: label });
    await expect(failure).toContainText(new RegExp(detail, "i"));
    await expect(failure).toContainText("no matching frame");
    await failure.scrollIntoViewIfNeeded();
    await expect(failure).toBeVisible();
    await info.attach(`${backend} ${kind} failure`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await info.attach(`${backend} ${kind} recording`, {
      body: JSON.stringify(recording),
      contentType: "application/json",
    });
    expect(pageErrors).toEqual([]);
  });
}

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${backend} real loading, compilation, failure and cancellation stay independent of capture`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/checks/three.html?backend=${backend}`);
    const baseline = page.getByRole("button", { name: "Baseline", exact: true });
    await expect
      .poll(async () => (await baseline.isEnabled()) || (await page.getByRole("alert").count()) > 0)
      .toBe(true);
    if (await page.getByRole("alert").count()) {
      expect(info.project.name, "Native loading checks require a real renderer").not.toBe(
        "chrome-gpu",
      );
      expect(backend).toBe("webgpu");
      await expect(page.getByRole("alert")).toContainText(
        /WebGPU.*(not available|no available GPU adapter)/,
      );
      return;
    }
    const panel = page.getByRole("complementary", { name: "Live Jank panel" });
    await panel.getByRole("tab", { name: "Loading", exact: true }).click();
    const body = panel.getByRole("tabpanel", { name: /^Loading/ });
    await expect(body).toContainText("No load sessions yet");
    let release = () => {};
    let gate: Promise<void> | null = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route("**/checks/assets/loading-*.json", async (route) => {
      requests++;
      if (gate !== null) await gate;
      await route.continue().catch(() => {});
    });
    try {
      await panel.getByRole("button", { name: "Rec", exact: true }).click();
      await panel.getByRole("tab", { name: "Loading", exact: true }).click();
      await panel.getByRole("button", { name: "Freeze", exact: true }).click();
      await page.getByRole("button", { name: "Load + compile", exact: true }).click();
      await expect.poll(() => requests).toBe(2);
      await expect(panel.getByRole("status", { name: "Loading", exact: true })).toBeVisible();
      await expect(panel.getByRole("status", { name: "Recording", exact: true })).toBeVisible();
      await expect(body).toContainText("No load sessions yet");
      await panel.getByRole("button", { name: "Freeze", exact: true }).click();
      await expect(body.getByRole("status", { name: "Loading session in progress" })).toBeVisible();
      await expect(body.getByRole("region", { name: "Loading outcomes" })).toContainText(
        "Running2",
      );
      release();
      gate = null;
      await expect(body.getByRole("status", { name: "Loading session ready" })).toBeVisible();
      await expect(
        body
          .getByRole("region", { name: "Stages waterfall" })
          .getByRole("img", { name: /^compile,/ }),
      ).toBeVisible();
      await expect(
        body.getByRole("region", { name: "Loading cache" }).getByRole("row", { name: /^assets/ }),
      ).toContainText(/\d+ B/);
      await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText(
        "Cache hitsUnknown",
      );
      if (backend === "webgpu")
        await expect(body.getByText(/\d+ of \d+ compilation work items finished/)).toBeVisible();
      await panel.getByRole("tab", { name: "Capture (0)", exact: true }).click();
      await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
      await expect(panel.getByRole("tab", { name: "Capture (1)", exact: true })).toBeVisible();
      await panel.getByRole("tab", { name: "Loading", exact: true }).click();
      await info.attach(`${backend} loaded asset`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await page.getByRole("button", { name: "Load + compile", exact: true }).click();
      await expect(page.getByRole("button", { name: "Load + compile", exact: true })).toBeEnabled();
      await expect(body.getByLabel("Session", { exact: true })).toContainText("Session 2");
      await expect(body).toContainText("Warm · repeat");
      await expect(body.locator('dl[aria-label="Loading summary"]')).toContainText(
        "no matching run",
      );
      await page.getByRole("button", { name: "Load missing asset", exact: true }).click();
      await expect(body.getByRole("status", { name: "Loading session failed" })).toBeVisible();
      await expect(body.getByRole("alert")).toContainText("404");
      await expect(baseline).toBeEnabled();
      const frame = await panel
        .getByRole("region", { name: "Live performance panel" })
        .getAttribute("data-frame");
      await expect
        .poll(
          async () =>
            await panel
              .getByRole("region", { name: "Live performance panel" })
              .getAttribute("data-frame"),
        )
        .not.toBe(frame);
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const before = requests;
      await page.getByRole("button", { name: "Load + compile", exact: true }).click();
      await expect.poll(() => requests).toBe(before + 2);
      await expect(body.getByRole("status", { name: "Loading session in progress" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel loading", exact: true }).click();
      await expect(body.getByRole("status", { name: "Loading session cancelled" })).toBeVisible();
      release();
      gate = null;
      await expect(page.getByRole("button", { name: "Load + compile", exact: true })).toBeEnabled();
      await expect(panel.getByRole("tab", { name: "Capture (1)", exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}

/** False only where headless Chromium has no WebGPU; the native run must have working hardware. */
async function sceneReady(page: Page, backend: string, project: string, query = "") {
  await page.goto(`/checks/three.html?backend=${backend}${query}`);
  const controls = page.getByRole("button", { name: "Baseline", exact: true });
  await expect
    .poll(async () => (await controls.isEnabled()) || (await page.getByRole("alert").count()) > 0)
    .toBe(true);
  if (!(await page.getByRole("alert").count())) return true;
  expect(project, "The native GPU run requires working hardware.").not.toBe("chrome-gpu");
  expect(backend).toBe("webgpu");
  return false;
}
async function comparisonPanel(
  page: Page,
  plan: { warmup: string; measure: string; pairs: string },
) {
  const panel = page.getByRole("complementary", { name: "Live Jank panel" });
  await panel.getByRole("tab", { name: /^Compare/ }).click();
  const body = panel.getByRole("tabpanel", { name: /^Compare/ });
  await body.getByLabel("Warm-up per trial (seconds)").fill(plan.warmup);
  await body.getByLabel("Measure per trial (seconds)").fill(plan.measure);
  await body.getByLabel("Pairs").fill(plan.pairs);
  return { panel, body };
}
async function exported(page: Page, button: Locator) {
  const download = page.waitForEvent("download");
  await button.click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing comparison download");
  return path;
}

for (const backend of ["webgl2", "webgpu"] as const) {
  test(`${backend} comparison switches the real workload, restores it and re-imports`, async ({
    page,
  }, info) => {
    test.slow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (!(await sceneReady(page, backend, info.project.name))) return;
    const { panel, body } = await comparisonPanel(page, {
      warmup: "0.2",
      measure: "1",
      pairs: "1",
    });
    await expect(body.getByRole("region", { name: "Comparison variants" })).toContainText(
      "CPU stress",
    );
    // A paused scene must not reach the trials, and must come back paused afterwards.
    await page.getByRole("button", { name: "Pause workload", exact: true }).click();
    await page.getByRole("slider", { name: "Configured instances" }).fill("200");
    await page.getByRole("checkbox", { name: "Show instanced mesh", exact: true }).uncheck();
    await body.getByRole("button", { name: "Run comparison", exact: true }).click();
    const instances = page.getByRole("slider", { name: "Configured instances" });
    await expect(instances).toBeDisabled();
    await expect(page.getByRole("button", { name: "Baseline", exact: true })).toBeDisabled();
    await expect(page.getByText("A/B COMPARISON RUNNING")).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Compare, complete" })).toBeVisible({
      timeout: 30_000,
    });

    await expect(instances).toBeEnabled();
    await expect(instances).toHaveValue("200");
    await expect(page.getByRole("button", { name: "Resume workload", exact: true })).toBeVisible();
    await expect(page.getByText(/^WORKLOAD PAUSED/)).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Show instanced mesh", exact: true }),
    ).not.toBeChecked();

    const path = await exported(page, body.getByRole("button", { name: "Export 2 trials" }));
    const bundle = parseComparison(await readFile(path, "utf8"));
    expect(bundle.status).toBe("complete");
    expect(bundle.change).toBe("cpuMs");
    expect(bundle.variants.A.settings).toMatchObject({ backend, cpuMs: 0 });
    expect(bundle.variants.B.settings).toMatchObject({ backend, cpuMs: 14 });
    expect(bundle.trials.map((trial) => trial.variant)).toEqual(["A", "B"]);
    // The recordings themselves prove which workload ran in each trial.
    for (const trial of bundle.trials) {
      const seen = trial.recording.samples.flatMap((sample) =>
        sample.systems
          .filter((system) => system.id === "simulation")
          // biome-ignore lint/complexity/useLiteralKeys: Index signatures require bracket access.
          .map((system) => system.values["extraWorkMs"]),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set([trial.variant === "A" ? 0 : 14]));
    }
    const results = comparisonResults(bundle);
    // Without timer support the absence is stated once, not as a failing trial.
    if (await page.getByText("GPU timing unsupported", { exact: true }).count()) {
      expect(results.gpuRecorded).toBe(false);
      await expect(body.getByRole("article", { name: "GPU verdict" })).toContainText(
        "No GPU timing was recorded",
      );
    }
    const cpu = results.results.find((metric) => metric.id === "CPU-median");
    // A slow machine can miss the sample minimum; the run must then say Unknown, not guess.
    const enough = bundle.trials.every(
      (trial) => trial.recording.frames.length >= bundle.policy.minSamples,
    );
    expect(cpu?.verdict).toBe(enough ? "B slower" : "Unknown");
    if (enough) expect(cpu?.delta).toBeGreaterThan(10);
    if (info.project.name === "chrome-gpu") {
      expect(results.gpuRecorded).toBe(true);
      expect(results.results.find((metric) => metric.id === "GPU-median")?.failure).toBeNull();
    }

    await page.goto("/viewer.html");
    await page.getByLabel("Open recording or comparison file").setInputFiles(path);
    const viewer = page.locator("[data-comparison-view]");
    await expect(viewer.getByRole("article", { name: "CPU verdict" })).toContainText(
      enough ? "B slower" : "Unknown",
    );
    await viewer.getByRole("tab", { name: "Frame", exact: true }).click();
    const paired = viewer.getByRole("region", { name: "Paired frames" });
    await expect(paired.getByRole("region", { name: "Paired CPU scopes" })).toContainText(
      "simulation",
    );
    await info.attach(`${backend} comparison in viewer`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  });
}

test("Stop and a renderer failure keep finished trials, with their cause, through re-import", async ({
  page,
}, info) => {
  test.slow();
  if (!(await sceneReady(page, "webgl2", info.project.name))) return;
  const { panel, body } = await comparisonPanel(page, {
    warmup: "0.1",
    measure: "0.5",
    pairs: "2",
  });
  const finishedOne = () =>
    expect(body.getByRole("region", { name: "Finished comparison trials" })).toContainText(
      /1 \/ 4/,
      { timeout: 15_000 },
    );
  await body.getByRole("button", { name: "Run comparison", exact: true }).click();
  await finishedOne();
  await body.getByRole("button", { name: /Stop comparison/ }).click();
  // A slower engine can finish another trial before the click lands; none may be lost.
  await expect(body).toContainText(/Stopped after [1-3] of 4 trials/);
  await expect(page.getByRole("slider", { name: "Configured instances" })).toBeEnabled();
  const stopped = parseComparison(
    await readFile(
      await exported(page, body.getByRole("button", { name: /^Export \d trials?$/ })),
      "utf8",
    ),
  );
  expect(stopped).toMatchObject({ status: "stopped" });
  expect(stopped.trials.length).toBeGreaterThanOrEqual(1);

  await body.getByRole("button", { name: "Run again" }).click();
  await finishedOne();
  await page.getByLabel("WebGL2 animated instanced scene").evaluate((canvas) => {
    (canvas as HTMLCanvasElement)
      .getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  });
  await expect(page.getByRole("alert").first()).toContainText("WebGL context lost");
  await expect(panel.locator("[data-panel-notice]")).toContainText("Renderer failure");
  await expect(body).toContainText(/Failed after [1-3] of 4 trials/);
  const path = await exported(page, body.getByRole("button", { name: /^Export \d trials?$/ }));
  const failed = parseComparison(await readFile(path, "utf8"));
  expect(failed.status).toBe("failed");
  expect(failed.reason).toContain("WebGL context lost");
  expect(failed.trials.length).toBeGreaterThanOrEqual(1);

  await page.goto("/viewer.html");
  await page.getByLabel("Open recording or comparison file").setInputFiles(path);
  const viewer = page.locator("[data-comparison-view]");
  await expect(viewer).toContainText("Comparison failed. Renderer failure");
  await expect(viewer).toContainText(`${failed.trials.length} of 4 trials retained`);
  // At most three of four can finish before the failure, so pair 2 always lacks a trial.
  await viewer.getByRole("radio", { name: "Pair 2 · B then A" }).check();
  await viewer.getByRole("tab", { name: "Frame", exact: true }).click();
  await expect(viewer.getByRole("region", { name: "Paired frames" })).toContainText(
    "was not completed.",
  );
});

test("a preset that changes several settings warns about the confounds", async ({ page }, info) => {
  if (!(await sceneReady(page, "webgl2", info.project.name, "&compare=GPU+stress"))) return;
  const { body } = await comparisonPanel(page, { warmup: "0.5", measure: "1", pairs: "2" });
  const variants = body.getByRole("region", { name: "Comparison variants" });
  await expect(variants).toContainText("Change under test: instances");
  await expect(variants).toContainText("2 other settings differ: passes, resolution");
});
