import { readdir, readFile, writeFile } from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { readBuildInfo } from "./build-info.mjs";

const licenseNames = (await readdir("licenses")).filter((name) => name.endsWith(".txt")).toSorted();

const notices = (
  await Promise.all(
    ["LICENSE", "THIRD_PARTY_NOTICES.md", ...licenseNames.map((name) => `licenses/${name}`)].map(
      async (name) => `${name}\n\n${await readFile(name, "utf8")}`,
    ),
  )
).join("\n\n────────────────────────────────────────\n\n");

// Retained in the file but not rendered: the viewer fills its window.
const licenseNotices = `<script type="text/plain" id="licenses">${notices.replaceAll("</script", "<\\/script")}</script>`;

await build({
  configFile: false,
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  plugins: [tailwindcss()],
  publicDir: false,
  build: {
    target: "es2023",
    outDir: "dist/viewer-assets",
    lib: {
      entry: "src/viewer/entry.tsx",
      name: "JankViewer",
      formats: ["iife"],
      fileName: () => "viewer.js",
    },
    cssCodeSplit: false,
    minify: true,
  },
});

const viewerJs = await readFile("dist/viewer-assets/viewer.js", "utf8");

const viewerFiles = await readdir("dist/viewer-assets");

const viewerCss = (
  await Promise.all(
    viewerFiles
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFile(`dist/viewer-assets/${name}`, "utf8")),
  )
).join("\n");

const viewerHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>jank.js recording viewer</title><style>html,body,#viewer{height:100%;margin:0;background:#000}${viewerCss}</style></head><body><div id="viewer"></div>${licenseNotices}<script>${viewerJs.replaceAll("</script", "<\\/script")}</script></body></html>`;

await Promise.all([
  writeFile("OPEN RECORDING VIEWER.html", viewerHtml),
  writeFile("dist-package/viewer.html", viewerHtml),
]);

console.log("Built self-contained recording viewer and package export.");
