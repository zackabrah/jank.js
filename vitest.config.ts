import { readBuildInfo } from "./scripts/build-info.mjs";

import { defineConfig } from "vitest/config";

// Shared CI runners are slower than either workstation; simulation-heavy tests need more headroom there.
const ciTestTimeoutMs = 60_000;

const localTestTimeoutMs = 5_000;

export default defineConfig({
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: process.env["CI"] ? ciTestTimeoutMs : localTestTimeoutMs,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "html"],
      // Floors at the measured levels, so coverage can rise but never quietly fall. The
      // viewer and graph drawing are canvas and DOM code covered by the Playwright suite.
      thresholds: {
        lines: 66,
        statements: 64,
        functions: 68,
        branches: 60,
        "src/core/**": {
          lines: 91,
          statements: 88,
          functions: 97,
          branches: 80,
        },
      },
    },
  },
});
