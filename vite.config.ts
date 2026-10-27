import { defineConfig } from "vite";

import { readBuildInfo } from "./scripts/build-info.mjs";

export default defineConfig({
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
});
