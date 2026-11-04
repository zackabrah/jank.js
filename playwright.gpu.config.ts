import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

/** Explicit hardware run: no unsafe browser flags or software-GPU fallback. */
export default defineConfig({
  ...base,
  testMatch: "three.spec.ts",
  workers: 1,
  projects: [
    { name: "chrome-gpu", use: { browserName: "chromium", channel: "chrome", headless: false } },
  ],
});
