import { expect, test } from "@playwright/test";

for (const surface of ["standalone", "dialog"] as const) {
  test(`${surface} viewer confines scrolling to its content panes`, async ({ page }, info) => {
    if (surface === "standalone") {
      await page.goto("/checks/viewer.html");
    } else {
      await page.goto("/checks/capture.html");
      const panel = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Idle · dark", exact: true }),
      });
      await panel.getByRole("button", { name: "Start recording", exact: true }).click();
      await panel.getByRole("button", { name: "Advance 4 reference frames" }).click();
      await panel.getByRole("button", { name: "Stop and save", exact: true }).click();
      await panel
        .getByRole("status", { name: "Capture C1 saved", exact: true })
        .getByRole("button", { name: "Open", exact: true })
        .click();
    }
    const viewer =
      surface === "standalone"
        ? page.locator("#viewer")
        : page.getByRole("dialog", { name: "Recording viewer · Capture C1" });
    const main = viewer.locator("main");
    for (const viewport of [
      { width: 1920, height: 963 },
      { width: 1440, height: 500 },
      { width: 1024, height: 480 },
      { width: 1440, height: 1140 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await main.evaluate((element) => {
        const host = (element.getRootNode() as ShadowRoot).host;
        const outer = host.closest("dialog") ?? element.ownerDocument.scrollingElement;
        const footer = element.querySelector("footer");
        if (!footer || !outer) throw new Error("Missing viewer layout");
        outer.scrollTop = outer.scrollHeight;
        return {
          bottom: element.getBoundingClientRect().bottom,
          footerBottom: footer.getBoundingClientRect().bottom,
          footerTop: footer.getBoundingClientRect().top,
          outerOverflow: host.scrollHeight - host.clientHeight,
          pageOverflow: outer.scrollHeight - outer.clientHeight,
          pageScroll: outer.scrollTop,
        };
      });
      expect(bounds.pageOverflow).toBe(0);
      expect(bounds.pageScroll).toBe(0);
      expect(bounds.bottom).toBe(viewport.height);
      expect(bounds.footerBottom).toBe(viewport.height);
      expect(bounds.outerOverflow).toBe(0);
      const panes = main.locator(":scope > div > div, :scope > div > aside");
      await expect(panes).toHaveCount(2);
      for (const pane of await panes.all()) {
        const box = await pane.boundingBox();
        if (!box) throw new Error("Missing scroll area");
        expect(box.height).toBeGreaterThan(0);
        expect(box.y + box.height).toBe(bounds.footerTop);
        const end = await pane.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          return { offset: element.scrollTop, max: element.scrollHeight - element.clientHeight };
        });
        expect(Math.abs(end.offset - end.max)).toBeLessThanOrEqual(1);
      }
      expect(
        await main.evaluate((element) => {
          const host = (element.getRootNode() as ShadowRoot).host;
          const outer = host.closest("dialog") ?? element.ownerDocument.scrollingElement;
          return outer ? outer.scrollHeight - outer.clientHeight : null;
        }),
      ).toBe(0);
      await info.attach(`${surface} ${viewport.width}x${viewport.height}`, {
        body: await viewer.screenshot(),
        contentType: "image/png",
      });
    }
  });
}
