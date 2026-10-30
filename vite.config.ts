import { defineConfig } from "vite";

// Resolve both renderer entry points before fixtures load, avoiding optimizer-triggered reloads.
export default defineConfig({ optimizeDeps: { include: ["three", "three/webgpu", "three/tsl"] } });
