import { expect, test } from "@playwright/test";
import { counterComparisonFixture } from "../fixtures/counter-comparison.ts";
import { recordingFixture } from "../fixtures/recording.ts";

const file = () => ({
  name: "recording.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(recordingFixture())),
});

test("nearby events jump by time and frame copy retains selected evidence", async ({ page }) => {
  await page.goto("/examples/viewer/");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.body.dataset.copied = text;
        },
      },
    });
  });
  await page.getByLabel("Open recording or comparison").setInputFiles(file());
  await expect(page.locator("[data-nearby-events]")).toContainText("+20.00 ms");
  await page.locator("[data-nearby-event]").click();
  await expect(page.locator("[data-viewer-frame]")).toContainText("#2");
  await expect(page.locator("[data-nearby-event]")).toBeFocused();
  await page.getByRole("button", { name: "Copy frame", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Frame #2 copied");
  const copied = JSON.parse((await page.locator("body").getAttribute("data-copied")) ?? "null");
  expect(copied.frame.id).toBe(2);
  expect(copied.frame.cpu.updateMs).toBeNull();
  expect(copied.counters[0].observation.ageMs).toBe(6);
  expect(copied.gpu).toEqual([]);
});

test("clipboard rejection offers a selectable report and selection clears stale evidence", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    });
  });
  await page.getByLabel("Open recording or comparison").setInputFiles(file());
  await page.getByRole("button", { name: "Copy frame", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Clipboard unavailable");
  await expect(page.getByLabel("Frame evidence for manual copy")).toContainText('"id": 1');
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(page.getByLabel("Frame evidence for manual copy")).toBeHidden();
});

test("late clipboard failures cannot restore old evidence after selection, replacement or disposal", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  const results = await page.evaluate(async (recording) => {
    const path = "/packages/jank/src/index.ts";
    const api: typeof import("../../packages/jank/src/index.ts") = await import(path);
    const outcomes: boolean[] = [];
    for (const action of ["select", "replace", "dispose"]) {
      let rejectCopy: ((cause: Error) => void) | undefined;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((_resolve, reject) => {
              rejectCopy = reject;
            }),
        },
      });
      const container = document.createElement("div");
      document.body.append(container);
      const viewer = api.createViewer({ container });
      viewer.load(recording);
      container.querySelector<HTMLButtonElement>("[data-copy-frame]")?.click();
      if (action === "select") {
        viewer.selectFrame(2);
      }
      if (action === "replace") {
        viewer.load(recording);
      }
      if (action === "dispose") {
        viewer.dispose();
      }
      rejectCopy?.(new Error("Late failure"));
      await Promise.resolve();
      outcomes.push(!container.querySelector("[data-copy-fallback]:not([hidden])"));
      viewer.dispose();
      container.remove();
    }
    return outcomes;
  }, recordingFixture());
  expect(results).toEqual([true, true, true]);
});

test("an event inside a frame gap stays unselected and disables frame copy", async ({ page }) => {
  await page.goto("/examples/viewer/");
  const recording = recordingFixture();
  const gap = {
    ...recording,
    frames: recording.frames.map((frame, index) =>
      index === 0
        ? frame
        : {
            ...frame,
            startedAtMs: frame.startedAtMs + 10,
            endedAtMs: frame.endedAtMs + 10,
            scopes: [],
          },
    ),
  };
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles({ ...file(), buffer: Buffer.from(JSON.stringify(gap)) });
  await page.locator("[data-nearby-event]").click();
  await expect(page.locator("[data-viewer-frame]")).toContainText(
    "No frame at the selected elapsed time",
  );
  await expect(page.getByRole("button", { name: "Copy frame", exact: true })).toBeDisabled();
  await expect(page.locator("[data-nearby-event]")).toContainText("0.00 ms");
});

test("A/B counter changes use each trial's previous valid sample and copy the selected trial", async ({
  page,
}) => {
  await page.goto("/examples/viewer/");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.body.dataset.copied = text;
        },
      },
    });
  });
  await page
    .getByLabel("Open recording or comparison")
    .setInputFiles({ ...file(), buffer: Buffer.from(JSON.stringify(counterComparisonFixture())) });
  await page.getByRole("combobox", { name: "Trial", exact: true }).selectOption("1");
  await page.getByText("FRAME DETAILS", { exact: true }).click();
  await page.getByLabel("Frame position", { exact: true }).fill("21");
  await page.getByLabel("Frame position", { exact: true }).press("Enter");
  const row = page.locator("[data-counter-inspector] tbody tr").first();
  await expect(row.locator("td").nth(1)).toContainText("Δ prev -10 · 3 invalid");
  await expect(row.locator("td").nth(2)).toContainText("Δ prev -20 · 3 invalid");
  await page.getByRole("button", { name: "Copy frame", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Frame #21 copied");
  const copied = JSON.parse((await page.locator("body").getAttribute("data-copied")) ?? "null");
  expect(copied.trial.variant).toBe("B");
  expect(copied.elapsedMs).toBe(400);
  expect(copied.counters[0].observation.change).toMatchObject({
    value: -20,
    skippedSamples: 3,
    intervalMs: 400,
  });
});
