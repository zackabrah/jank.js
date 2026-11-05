import { defineConfig } from "@playwright/test";

const { CI } = process.env;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!CI,
  retries: CI ? 1 : 0,
  // Hosted macOS runners have 3 cores and render in software, so everything can run far slower.
  timeout: CI ? 120_000 : 30_000,
  expect: { timeout: CI ? 20_000 : 5_000 },
  globalTimeout: (CI ? 40 : 15) * 60_000,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "artifacts/e2e/results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4178 --strictPort",
    url: "http://127.0.0.1:4178/checks/live.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
