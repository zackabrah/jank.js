import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { readBuildIdentity } from "./build-identity.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2] ?? "ui-library";
const targets = {
  "ui-library": {
    entry: "showcase.ts",
    marker: "library-styles",
    name: "JankUiLibrary",
    filename: "jank-ui-library.html",
  },
  viewer: {
    entry: "main.ts",
    marker: "viewer-styles",
    name: "JankViewer",
    filename: "jank-viewer.html",
  },
};
const configuration = targets[target];
if (!configuration) {
  throw new Error("Choose ui-library or viewer");
}
const source = `${root}examples/${target}/`;
// Resolve the actual source in this artifact; no stale dist output or external runtime dependencies.
const result = await build({
  root,
  configFile: false,
  define: { __JANK_BUILD_REVISION__: JSON.stringify(readBuildIdentity().revision) },
  logLevel: "silent",
  resolve: {
    alias: [
      { find: /^junkui$/, replacement: `${root}packages/junkui/src/index.ts` },
      { find: "junkui/styles.css", replacement: `${root}packages/junkui/src/junkui.css` },
    ],
  },
  build: {
    write: false,
    minify: false,
    sourcemap: false,
    lib: { entry: `${source}${configuration.entry}`, name: configuration.name, formats: ["iife"] },
  },
});
const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const scripts = outputs.filter((item) => item.type === "chunk");
const styles = outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css"));
if (scripts.length !== 1 || styles.length !== 1 || outputs.length !== 2) {
  throw new Error("Standalone artifact must contain exactly one script and one stylesheet");
}
const script = scripts[0].code.replaceAll("</script", "<\\/script");
const style = String(styles[0].source).replaceAll("</style", "<\\/style");
const template = await readFile(`${source}index.html`, "utf8");
const html = template
  .replace(`<!-- ${configuration.marker} -->`, () => `<style>${style}</style>`)
  .replace(
    `<script type="module" src="./${configuration.entry}"></script>`,
    () => `<script>${script}</script>`,
  );
const destination = `${root}artifacts/${configuration.filename}`;
await mkdir(`${root}artifacts`, { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, html);
await rename(temporary, destination);
console.log(`Built ${destination} (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`);
