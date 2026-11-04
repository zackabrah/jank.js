import { defineConfig } from "vite";

// Separate from the library build, whose guard rejects Node built-ins.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "cli/bin.ts",
    target: "node22",
    outDir: "dist-package",
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "jank-cli.js", banner: "#!/usr/bin/env node" } },
  },
});
