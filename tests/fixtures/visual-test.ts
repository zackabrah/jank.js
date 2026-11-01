import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    if (
      browserName !== "chromium" ||
      process.platform !== "darwin" ||
      !testInfo.title.includes("@visual")
    ) {
      await use(page);
      return;
    }
    // Chromium 153 drops Playwright's generic font mappings during full-page capture.
    // Pin the native macOS monospace mapping before drawing, and retain the session
    // through navigation so capture cannot switch Courier/Menlo mid-comparison.
    // Remove after verifying the upstream fix: microsoft/playwright#42962.
    const session = await page.context().newCDPSession(page);
    await session.send("Page.setFontFamilies", {
      fontFamilies: { fixed: "Menlo" },
    });
    await use(page);
    await session.detach();
  },
});
