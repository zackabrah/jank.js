import { defineConfig } from "vite";

export default defineConfig({
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
