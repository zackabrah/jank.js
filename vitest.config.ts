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
  },
});
