import { readBuildInfo } from "./scripts/build-info.mjs";

import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    // Shared CI runners are slower than either workstation; simulation-heavy tests need more headroom there.
    testTimeout: process.env["CI"] ? 60_000 : 5_000,
  },
});
