import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

const { JANK_GPU_WS } = process.env;

/** Explicit hardware run: no unsafe browser flags or software-GPU fallback. */
export default defineConfig({
  ...base,
  testMatch: ["three.spec.ts", "hardware-gpu.spec.ts"],
  workers: 1,
  projects: [
    {
      name: "chrome-gpu",
      use: {
        browserName: "chromium",
        channel: "chrome",
        headless: false,
        ...(JANK_GPU_WS ? { connectOptions: { wsEndpoint: JANK_GPU_WS } } : {}),
      },
    },
  ],
});
