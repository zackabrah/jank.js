import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4182",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "pnpm exec vite preview --outDir dist/viewer --host 127.0.0.1 --port 4182 --strictPort",
    url: "http://127.0.0.1:4182/viewer/",
    reuseExistingServer: false,
  },
});
