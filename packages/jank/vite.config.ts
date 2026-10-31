import { defineConfig } from "vite";
import { readBuildIdentity } from "../../scripts/build-identity.ts";

export default defineConfig({
  define: { __JANK_BUILD_REVISION__: JSON.stringify(readBuildIdentity().revision) },
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        "adapters/three-counters": "src/adapters/three-counters.ts",
        "adapters/webgl2": "src/adapters/webgl2.ts",
        "adapters/three-webgpu": "src/adapters/three-webgpu.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    minify: false,
    sourcemap: true,
  },
});
