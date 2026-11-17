import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readBuildInfo } from "./scripts/build-info.mjs";
import { runtimeDependencyGuard } from "./vite.config.ts";

// Preact is bundled here, so consumers install nothing and the guard rejects any other runtime.
export default defineConfig({
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  plugins: [tailwindcss(), runtimeDependencyGuard],
  publicDir: false,
  build: {
    target: "es2023",
    outDir: "dist-package",
    lib: {
      entry: {
        index: "src/index.ts",
        panel: "src/panel-api.ts",
        gpu: "src/gpu-api.ts",
        agent: "src/agent-api.ts",
        viewer: "src/viewer/mount.tsx",
        "adapters/three": "src/adapters/three.ts",
        "adapters/three-host": "src/adapters/three-host.ts",
        "adapters/three-webgpu": "src/adapters/three-webgpu.ts",
        "adapters/webgl2": "src/adapters/webgl2.ts",
      },
      formats: ["es"],
    },
    sourcemap: true,
    minify: "oxc",
    cssMinify: "lightningcss",
  },
});
