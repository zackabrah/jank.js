import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "tests/fixtures/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/jank/src/core/**/*.ts",
        "packages/jank/src/recordings/**/*.ts",
        "packages/jank/src/profiler.ts",
        "packages/jank/src/browser/**/*.ts",
      ],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
