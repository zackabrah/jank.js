import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { recordingFixture } from "../fixtures/recording.ts";

async function mount(page: Page, viewerUrl = "/examples/viewer/") {
  await page.goto("/tests/fixtures/panel/?mode=full");
  await page.evaluate(async (viewerUrl) => {
    const path = "/packages/jank/src/index.ts";
    const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
    const fixture = window.panelFixture;
    fixture.panel.dispose();
    fixture.panel = api.createPanel({
      container: document.body,
      profiler: fixture.profiler,
      mode: "full",
      viewerUrl,
    });
    fixture.profiler.capture.start();
    fixture.advance(5);
  }, viewerUrl);
}

test("opens the stopped recording in a viewer and can open an older capture without stopping a new one", async ({
  page,
}) => {
  await mount(page);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  const viewer = await popup;
  await expect(viewer.locator("[data-viewer-frame]")).toContainText("Frame #1");
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("Opened in viewer");
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState().status)).toBe(
    "idle",
  );
  await page.evaluate(() => {
    window.panelFixture.profiler.capture.start();
    window.panelFixture.advance(3);
  });
  await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
  const second = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open capture 1 in viewer", exact: true }).click();
  const older = await second;
  await expect(older.locator("[data-viewer-frame]")).toContainText("Frame #1");
  expect(await page.evaluate(() => window.panelFixture.profiler.capture.getState().status)).toBe(
    "manual",
  );
});

test("blocked popups download the selected evidence and explain the fallback", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.open = () => null;
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("jank-manual.json");
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("Popup blocked");
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("Download requested");
});

for (const viewerUrl of [
  "file:///tmp/jank-viewer.html",
  "https://example.invalid/viewer",
  "javascript:alert(1)",
]) {
  test(`unsupported viewer URL falls back without opening it: ${viewerUrl}`, async ({ page }) => {
    await mount(page, viewerUrl);
    await page.evaluate(() => {
      window.open = () => {
        throw new Error("Must not navigate");
      };
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Open viewer", exact: true }).click();
    await download;
    await expect(page.locator("[data-viewer-transfer-status]")).toContainText(
      "same-origin HTTP(S)",
    );
  });
}

test("untrusted readiness and premature acknowledgements cannot send data or suppress timeout fallback", async ({
  page,
}) => {
  await mount(page, "/tests/fixtures/panel/?mode=line");
  await page.clock.install();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  const viewer = await popup;
  await viewer.waitForSelector('body[data-ready="true"]');
  await viewer.evaluate(() => {
    const token = new URL(location.href).searchParams.get("jank-handoff");
    const data = { protocol: "jank.js-viewer-v1", token, kind: "ready" };
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "kind" in event.data &&
        event.data.kind === "recording"
      ) {
        document.body.dataset.received = "true";
      }
    });
    opener.dispatchEvent(
      new MessageEvent("message", { source: window, origin: "https://untrusted.invalid", data }),
    );
    opener.dispatchEvent(
      new MessageEvent("message", { source: opener, origin: location.origin, data }),
    );
    opener.postMessage({ ...data, token: "wrong-token" }, location.origin);
    opener.postMessage({ ...data, kind: "accepted" }, location.origin);
  });
  const download = page.waitForEvent("download");
  await page.clock.fastForward(10001);
  await download;
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("did not acknowledge");
  await expect(viewer.locator("body")).not.toHaveAttribute("data-received", "true");
});

for (const action of ["clear", "dispose"] as const) {
  test(`${action} cancels a pending handoff without late transfer or download`, async ({
    page,
  }) => {
    await mount(page, "/tests/fixtures/panel/?mode=line");
    await page.clock.install();
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    const popup = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Open viewer", exact: true }).click();
    const viewer = await popup;
    await viewer.waitForSelector('body[data-ready="true"]');
    if (action === "clear") {
      await page.getByRole("button", { name: "CLEAR", exact: true }).click();
    } else {
      await page.evaluate(() => window.panelFixture.panel.dispose());
    }
    await page.clock.fastForward(10001);
    await viewer.evaluate(() => {
      opener.postMessage(
        {
          protocol: "jank.js-viewer-v1",
          token: new URL(location.href).searchParams.get("jank-handoff"),
          kind: "ready",
        },
        location.origin,
      );
    });
    expect(downloads).toEqual([]);
    await expect(page.locator("[data-viewer-transfer-status]:not([hidden])")).toHaveCount(0);
  });
}

test("receiver validates window, origin, token and recording; manual imports take precedence", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const token = "11111111-1111-4111-8111-111111111111";
  const popup = page.waitForEvent("popup");
  await page.evaluate((token) => {
    window.open(`/examples/viewer/?jank-handoff=${token}`, "_blank");
  }, token);
  const viewer = await popup;
  await viewer.waitForSelector('body[data-ready="true"]');
  const json = JSON.stringify(recordingFixture());
  await viewer.evaluate(
    ({ token, json }) => {
      const data = { protocol: "jank.js-viewer-v1", token, kind: "recording", json };
      window.dispatchEvent(
        new MessageEvent("message", { source: opener, origin: "https://untrusted.invalid", data }),
      );
      window.dispatchEvent(
        new MessageEvent("message", { source: window, origin: location.origin, data }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          source: opener,
          origin: location.origin,
          data: { ...data, token: "wrong-token" },
        }),
      );
    },
    { token, json },
  );
  await expect(viewer.locator("[data-viewer-empty]")).toBeVisible();
  await viewer
    .getByLabel("Open recording or comparison")
    .setInputFiles({ name: "local.json", mimeType: "application/json", buffer: Buffer.from(json) });
  await viewer.getByRole("button", { name: "Next frame", exact: true }).click();
  await viewer.evaluate(
    ({ token, json }) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: opener,
          origin: location.origin,
          data: { protocol: "jank.js-viewer-v1", token, kind: "recording", json },
        }),
      );
    },
    { token, json },
  );
  await expect(viewer.locator("[data-viewer-frame]")).toContainText("#2");
});

test("receiver rejects invalid recording data and accepts only one transfer per opening", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const token = "11111111-1111-4111-8111-111111111111";
  const popup = page.waitForEvent("popup");
  await page.evaluate((token) => {
    window.open(`/examples/viewer/?jank-handoff=${token}`, "_blank");
  }, token);
  const viewer = await popup;
  await viewer.waitForSelector('body[data-ready="true"]');
  await viewer.evaluate(
    ({ token, json }) => {
      const data = { protocol: "jank.js-viewer-v1", token, kind: "recording" };
      window.dispatchEvent(
        new MessageEvent("message", {
          source: opener,
          origin: location.origin,
          data: { ...data, json: "{}" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          source: opener,
          origin: location.origin,
          data: { ...data, json },
        }),
      );
    },
    { token, json: JSON.stringify(recordingFixture()) },
  );
  await expect(viewer.getByRole("alert")).toBeVisible();
  await expect(viewer.locator("[data-viewer-empty]")).toBeVisible();
});

test("a cleared GPU finalization cannot cancel a newer handoff", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const path = "/packages/jank/src/index.ts";
    const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
    const fixture = window.panelFixture;
    fixture.panel.dispose();
    let sequence = 0;
    fixture.panel = api.createPanel({
      container: document.body,
      profiler: fixture.profiler,
      mode: "full",
      viewerUrl: "/examples/viewer/",
      exportTimeoutMs: 10000,
      gpuResolver: {
        resolveFrames: () => {
          const id = ++sequence;
          return new Promise((resolve) =>
            document.addEventListener(
              `resolve-gpu-${id}`,
              () => resolve({ status: "settled", samples: [], pendingFrameIds: [] }),
              { once: true },
            ),
          );
        },
      },
    });
  });
  const firstPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  await firstPopup;
  await page.getByRole("button", { name: "CLEAR", exact: true }).click();
  await page.evaluate(() => {
    window.panelFixture.profiler.capture.start();
    window.panelFixture.advance(3);
  });
  const secondPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  const viewer = await secondPopup;
  await viewer.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => document.dispatchEvent(new Event("resolve-gpu-1")));
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("Opening viewer");
  await page.evaluate(() => document.dispatchEvent(new Event("resolve-gpu-2")));
  await expect(viewer.locator("[data-viewer-empty]")).toBeHidden();
  await expect(page.locator("[data-viewer-transfer-status]")).toContainText("Opened in viewer");
});

test("failed fallback retains the exact recent snapshot for a labelled retry", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const fixture = window.panelFixture;
    fixture.profiler.clear();
    fixture.advance(3);
    window.open = () => null;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {
      throw new Error("Download unavailable");
    };
    document.addEventListener(
      "restore-download",
      () => {
        HTMLAnchorElement.prototype.click = click;
      },
      { once: true },
    );
  });
  await page.getByRole("button", { name: "Open viewer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry viewer download", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.panelFixture.advance(10);
    document.dispatchEvent(new Event("restore-download"));
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Retry viewer download", exact: true }).click();
  const saved = await download;
  const stream = await saved.createReadStream();
  if (!stream) {
    throw new Error("Missing download stream");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  expect(JSON.parse(Buffer.concat(chunks).toString()).frames).toHaveLength(3);
});

for (const width of [1280, 360]) {
  test(`@visual viewer handoff controls and download retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page);
    await page.evaluate(() => {
      window.open = () => null;
      HTMLAnchorElement.prototype.click = () => {
        throw new Error("Download unavailable");
      };
    });
    await page.getByRole("button", { name: "Open viewer", exact: true }).click();
    await page.getByRole("tab", { name: "CAPTURE", exact: true }).click();
    await page
      .getByRole("button", { name: "Open capture 1 in viewer", exact: true })
      .scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(page.locator(".jank")).toHaveScreenshot(`panel-viewer-handoff-${width}.png`, {
      mask: [page.locator('[data-value="collection-cost"], [data-value="refresh-cost"]')],
      maskColor: "#0a0a0a",
    });
  });
}

test("late GPU finalization does not refresh a disposed panel", async ({ page }) => {
  await mount(page);
  const counts = await page.evaluate(async () => {
    const path = "/packages/jank/src/index.ts";
    const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
    const pending =
      Promise.withResolvers<import("../../packages/jank/src/core/gpu.ts").GpuFrameResolution>();
    let refreshes = 0;
    const fixture = window.panelFixture;
    fixture.panel.dispose();
    const profiler = new Proxy(fixture.profiler, {
      get(target, property, receiver) {
        if (property === "measureRefresh") {
          return <T>(render: () => T): T => {
            refreshes += 1;
            return target.measureRefresh(render);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    window.open = () => null;
    const panel = api.createPanel({
      container: document.body,
      profiler,
      mode: "full",
      viewerUrl: "/examples/viewer/",
      gpuResolver: { resolveFrames: () => pending.promise },
    });
    document.querySelector<HTMLButtonElement>('[data-action="open-viewer"]')?.click();
    panel.dispose();
    const before = refreshes;
    pending.resolve({ status: "settled", samples: [], pendingFrameIds: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { before, after: refreshes };
  });
  expect(counts.after).toBe(counts.before);
});
