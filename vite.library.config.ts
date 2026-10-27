import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    target: "es2023",
    outDir: "dist-package",
    lib: {
      entry: {
        index: "src/index.ts",
        "adapters/three": "src/adapters/three.ts",
        "adapters/three-webgpu": "src/adapters/three-webgpu.ts",
      },
      formats: ["es"],
    },
    sourcemap: true,
    minify: false,
  },
});
