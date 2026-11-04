import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Real Chrome on real hardware, so the README shows measurements rather than fixtures. */
export default defineConfig({
  ...base,
  testMatch: "readme.capture.ts",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "line",
  projects: [
    {
      name: "captures",
      use: {
        browserName: "chromium",
        channel: "chrome",
        headless: false,
        viewport: { width: 1440, height: 1140 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
