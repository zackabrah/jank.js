import { defineConfig } from "@playwright/test";

// JANK on a phone keypad: a port of its own, so other local preview servers don't collide.
const port = 5265;

const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    headless: true,
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir dist/viewer --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/viewer/`,
    reuseExistingServer: false,
  },
});
