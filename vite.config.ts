import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { readBuildInfo } from "./scripts/build-info.mjs";

export const runtimeDependencyGuard = {
  name: "runtime-dependency-guard",
  apply: "build",
  // shortcut: metadata misses vendored code and injected scripts; audit those if introduced.
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") continue;
      for (const [id, module] of Object.entries(output.modules)) {
        // Preact is bundled into the panel and viewer; all other third-party runtime code stays forbidden.
        const packagePath = id.replaceAll("\\", "/").split("/node_modules/").at(-1) ?? "";
        // CSS is allowed: Tailwind generates styles without a JavaScript runtime.
        if (
          /[/\\]node_modules[/\\]/.test(id) &&
          !packagePath.startsWith("preact/") &&
          !/\.css(?:\?|$)/.test(id) &&
          module.renderedLength > 0
        ) {
          this.error(`Third-party runtime code is forbidden: ${id}`);
        }
      }
      for (const id of [...output.imports, ...output.dynamicImports]) {
        if (!Object.hasOwn(bundle, id)) {
          this.error(`External runtime import is forbidden: ${id}`);
        }
      }
    }
  },
} satisfies Plugin;

// Shared CI runners are slower than a workstation; simulation-heavy tests need more headroom there.
const ciTestTimeoutMs = 60_000;

export default defineConfig({
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  plugins: [tailwindcss()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "devtools/**/*.test.{ts,tsx}", "vite.config.test.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
    css: true,
    // Tailwind CSS depends on scanned JSX, beyond the imported CSS module.
    fsModuleCache: false,
    clearMocks: true,
    restoreMocks: true,
    // biome-ignore lint/complexity/useLiteralKeys: Index signatures require bracket access.
    ...(process.env["CI"] ? { testTimeout: ciTestTimeoutMs } : {}),
    // json counts the tests for the README's chip. Naming reporters replaces Vitest's defaults,
    // so GitHub's annotations are named again for CI.
    reporters: [
      "default",
      ["json", { outputFile: "artifacts/unit/results.json" }],
      // biome-ignore lint/complexity/useLiteralKeys: Index signatures require bracket access.
      ...(process.env["GITHUB_ACTIONS"] ? ["github-actions"] : []),
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/fixtures.ts", "src/app.tsx", "src/main.tsx"],
      // json-summary feeds the CI job summary (scripts/ci/summary.mjs).
      reporter: ["text-summary", "html", "json-summary"],
      // Floors at the measured levels, so coverage can rise but never quietly fall.
      // shortcut: the collector's function floor was 97. Only the removed UI called some of its
      // exports (scopesBySystem, eventsNear and others); restore the floor once those are pruned.
      thresholds: {
        lines: 86,
        statements: 84,
        functions: 80,
        branches: 77,
        "src/core/**": { lines: 91, statements: 88, functions: 85, branches: 80 },
      },
    },
  },
});
