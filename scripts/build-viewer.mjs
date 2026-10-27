import { readBuildInfo } from "./build-info.mjs";

import { build } from "vite";

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";

const licenseNames = (await readdir("licenses"))
  .filter((name) => name.endsWith(".txt"))
  .toSorted();

const notices = (
  await Promise.all(
    [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      ...licenseNames.map((name) => `licenses/${name}`),
    ].map(async (name) => `${name}\n\n${await readFile(name, "utf8")}`),
  )
).join("\n\n────────────────────────────────────────\n\n");

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const licensePanel = `<details class="license-notices"><summary>Licenses</summary><pre>${escapeHtml(notices)}</pre></details>`;

await build({
  configFile: false,
  define: { JANK_BUILD_INFO: JSON.stringify(readBuildInfo()) },
  publicDir: false,
  build: {
    target: "es2023",
    outDir: "dist/viewer-assets",
    lib: {
      entry: "src/viewer/entry.ts",
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

const viewerHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>jank.js recording viewer</title><style>${viewerCss}</style></head><body><main id="app"></main>${licensePanel}<script>${viewerJs.replaceAll("</script", "<\\/script")}</script></body></html>`;

await mkdir("dist/viewer/viewer", { recursive: true });

await Promise.all([
  writeFile("OPEN RECORDING VIEWER.html", viewerHtml),
  writeFile("dist-package/viewer.html", viewerHtml),
  writeFile("dist/viewer/viewer/index.html", viewerHtml),
]);

console.log("Built self-contained recording viewer and package export.");
