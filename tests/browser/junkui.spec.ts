import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/packages/junkui/gallery/");
  await expect(page.locator("#gallery")).toHaveAttribute("data-ready", "true", { timeout: 5000 });
});

test("tabs connect labels and panels without notifying on mount", async ({ page }) => {
  const tabs = page.getByRole("tablist", { name: "Control examples" });
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  const controls = page.getByRole("tab", { name: "CONTROLS", exact: true });
  await expect(controls).toHaveAttribute("aria-selected", "true");
  await expect(controls).toHaveAttribute("tabindex", "0");
  await expect(controls).toHaveAttribute("aria-controls", "controls-panel");
  await expect(page.getByRole("tabpanel", { name: "CONTROLS", exact: true })).toBeVisible();
  await expect(page.locator("#fields-panel")).toBeHidden();
  await expect(page.locator("#changes")).toHaveText("0");
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "FIELDS", exact: true })).toBeVisible();
  await expect(controls).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#changes")).toHaveText("1");
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await expect(page.locator("#changes")).toHaveText("1");
});

test("keyboard selection wraps, skips disabled tabs and leaves vertical scrolling alone", async ({
  page,
}) => {
  const controls = page.getByRole("tab", { name: "CONTROLS", exact: true });
  const fields = page.getByRole("tab", { name: "FIELDS", exact: true });
  const details = page.getByRole("tab", { name: "DETAILS", exact: true });
  await controls.focus();
  await page.keyboard.press("ArrowRight");
  await expect(fields).toBeFocused();
  await expect(fields).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(details).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(controls).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(details).toBeFocused();
  await page.keyboard.press("Home");
  await expect(controls).toBeFocused();
  await page.keyboard.press("End");
  await expect(details).toBeFocused();
  const handled = await details.evaluate((button) => {
    return ["ArrowDown", "ArrowUp", "ArrowRight"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey: key === "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(handled).toEqual([false, false, false]);
  await page.keyboard.press("Tab");
  await expect(page.locator("#details-panel")).toBeFocused();
});

test("programmatic selection keeps outside focus and disposal preserves caller DOM and listeners", async ({
  page,
}) => {
  await page.getByRole("button", { name: "SELECT FIELDS", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "SELECT FIELDS", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "FIELDS", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator("#controls-tab").evaluate((button) => {
    button.addEventListener("click", () => button.setAttribute("data-host-clicked", "true"));
  });
  await page.getByRole("button", { name: "DISPOSE TABS", exact: true }).click();
  await page.getByRole("button", { name: "DISPOSE TABS", exact: true }).click();
  await page.getByRole("tab", { name: "CONTROLS", exact: true }).click();
  await expect(page.locator("#controls-tab")).toHaveAttribute("data-host-clicked", "true");
  await expect(page.locator("#fields-panel")).toBeVisible();
  await expect(page.locator("#changes")).toHaveText("1");
  await page.getByRole("button", { name: "SELECT FIELDS", exact: true }).click();
  await expect(page.locator("#changes")).toHaveText("1");
  await page.getByRole("button", { name: "MOUNT TABS", exact: true }).click();
  await page.getByRole("button", { name: "MOUNT TABS", exact: true }).click();
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await expect(page.locator("#changes")).toHaveText("2");
});

test("native fields, disclosure and pressed states remain usable", async ({ page }) => {
  const toggle = page.getByRole("button", { name: "Preview guides" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("A new title");
  await page.getByLabel("Count", { exact: true }).fill("24");
  await page.getByLabel("Density", { exact: true }).selectOption("Comfortable");
  await page.getByLabel("Show hints", { exact: true }).uncheck();
  await page.getByRole("button", { name: "VALIDATE", exact: true }).click();
  await expect(page.locator("#validation")).toHaveText("Fields are valid.");
  await page.getByRole("tab", { name: "DETAILS", exact: true }).click();
  const summary = page.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details")).toHaveAttribute("open", "");
  await expect(summary).toHaveCSS("display", "list-item");
});

test("theme preserves control dimensions, visible focus and host styles", async ({ page }) => {
  const primary = page.getByRole("button", { name: "PRIMARY", exact: true });
  const secondary = page.getByRole("button", { name: "SECONDARY", exact: true });
  await expect(primary).toHaveCSS("height", "28px");
  await expect(primary).toHaveCSS("color", "rgb(10, 10, 10)");
  await expect(primary).toHaveCSS("background-color", "rgb(232, 232, 232)");
  await primary.focus();
  await expect(primary).toHaveCSS("outline-style", "dotted");
  await expect(primary).toHaveCSS("outline-color", "rgb(10, 10, 10)");
  const host = page.locator("#host-button");
  const hostBefore = await host.evaluate((button) => button.getBoundingClientRect().height);
  await page.addStyleTag({
    content:
      "button { border-radius: 30px; font: bold 30px serif; background: pink; padding: 40px; color: red; } input { height: 80px; } section { display: block; }",
  });
  await expect(secondary).toHaveCSS("height", "28px");
  await expect(secondary).toHaveCSS("border-radius", "0px");
  await expect(secondary).toHaveCSS("font-size", "11px");
  await expect(secondary).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await expect(page.locator("#fields-panel")).toBeHidden();
  expect(await host.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThan(
    hostBefore,
  );
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await expect(page.getByLabel("Count", { exact: true })).toHaveCSS("height", "20px");
});

test("all enabled gallery panels pass accessibility checks", async ({ page }) => {
  for (const name of ["CONTROLS", "FIELDS", "DETAILS"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
  }
});

test("@visual gallery keeps the compact visual baseline on desktop and narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await expect(page.locator("#gallery")).toHaveScreenshot("junkui-controls.png");
  await page.getByRole("tab", { name: "FIELDS", exact: true }).click();
  await expect(page.locator("#gallery")).toHaveScreenshot("junkui-fields.png");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.locator("#gallery")).toHaveScreenshot("junkui-fields-narrow.png");
});

for (const scenario of [
  "empty",
  "missing-selected",
  "duplicate-id",
  "missing-dom-id",
  "duplicate-panel",
  "outside-list",
  "disabled-selected",
  "missing-label",
]) {
  test(`invalid tab configuration (${scenario}) leaves caller DOM unchanged`, async ({ page }) => {
    const result = await page.evaluate(async (scenario) => {
      const modulePath = "/packages/junkui/src/index.ts";
      const { createTabs }: typeof import("../../packages/junkui/src/index.ts") = await import(
        modulePath
      );
      const root = document.createElement("div");
      root.innerHTML =
        '<div aria-label="Test"><button id="check-a">A</button><button id="check-b">B</button></div><section id="check-panel-a">Alpha</section><section id="check-panel-b">Beta</section>';
      document.body.append(root);
      const tablist = root.querySelector("div");
      const buttons = root.querySelectorAll("button");
      const panels = root.querySelectorAll("section");
      if (!tablist || !buttons[0] || !buttons[1] || !panels[0] || !panels[1]) {
        throw new Error("Invalid test fixture");
      }
      const tabs = [
        { id: "a", button: buttons[0], panel: panels[0] },
        { id: "b", button: buttons[1], panel: panels[1] },
      ];
      switch (scenario) {
        case "empty":
          tabs.length = 0;
          break;
        case "duplicate-id":
          tabs[1] = { id: "a", button: buttons[1], panel: panels[1] };
          break;
        case "missing-dom-id":
          buttons[0].removeAttribute("id");
          break;
        case "duplicate-panel":
          tabs[1] = { id: "b", button: buttons[1], panel: panels[0] };
          break;
        case "outside-list":
          root.append(buttons[1]);
          break;
        case "disabled-selected":
          buttons[0].disabled = true;
          break;
        case "missing-label":
          tablist.removeAttribute("aria-label");
          break;
        default:
          break;
      }
      const before = root.outerHTML;
      let rejected = false;
      try {
        createTabs({
          tablist,
          tabs,
          selectedId: scenario === "missing-selected" ? "missing" : "a",
        });
      } catch {
        rejected = true;
      }
      root.remove();
      return { rejected, unchanged: root.outerHTML === before };
    }, scenario);
    expect(result).toEqual({ rejected: true, unchanged: true });
  });
}

test("selection rehomes hidden focus, owns its tab descriptions and tolerates callback reentry", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/packages/junkui/src/index.ts";
    const { createTabs }: typeof import("../../packages/junkui/src/index.ts") = await import(
      modulePath
    );
    const root = document.createElement("div");
    root.innerHTML =
      '<div aria-label="Second instance"><button id="second-a">A</button><button id="second-b">B</button></div><section id="second-panel-a"><input aria-label="Inside panel" /></section><section id="second-panel-b">Beta</section>';
    document.body.append(root);
    const tablist = root.querySelector("div");
    const buttons = root.querySelectorAll("button");
    const panels = root.querySelectorAll("section");
    if (!tablist || !buttons[0] || !buttons[1] || !panels[0] || !panels[1]) {
      throw new Error("Invalid test fixture");
    }
    const tabs = [
      { id: "a", button: buttons[0], panel: panels[0] },
      { id: "b", button: buttons[1], panel: panels[1] },
    ];
    const selections: string[] = [];
    let returnToFirst = false;
    const control = createTabs({
      tablist,
      tabs,
      selectedId: "a",
      onSelect: (id) => {
        selections.push(id);
        if (id === "b" && returnToFirst) {
          control.select("a");
        }
      },
    });
    tabs.length = 0;
    root.querySelector("input")?.focus();
    control.select("b");
    const movedFocus = document.activeElement === buttons[1];
    control.select("a");
    returnToFirst = true;
    control.select("b");
    const selected = buttons[0].getAttribute("aria-selected");
    let rejectedDisabled = false;
    buttons[1].disabled = true;
    try {
      control.select("b");
    } catch {
      rejectedDisabled = true;
    }
    control.dispose();
    control.select("not-a-tab");
    root.remove();
    return { movedFocus, selected, selections, rejectedDisabled };
  });
  expect(result).toEqual({
    movedFocus: true,
    selected: "true",
    selections: ["b", "a", "b", "a"],
    rejectedDisabled: true,
  });
  await expect(page.locator("#controls-tab")).toHaveAttribute("aria-selected", "true");
});
