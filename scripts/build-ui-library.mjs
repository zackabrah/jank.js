import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}examples/ui-library/`;
// Resolve the actual source in this artifact; no stale dist output or external runtime dependencies.
const result = await build({
  root,
  configFile: false,
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
    lib: { entry: `${source}showcase.ts`, name: "JankUiLibrary", formats: ["iife"] },
  },
});
const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const scripts = outputs.filter((item) => item.type === "chunk");
const styles = outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css"));
if (scripts.length !== 1 || styles.length !== 1 || outputs.length !== 2) {
  throw new Error("Standalone library must contain exactly one script and one stylesheet");
}
const script = scripts[0].code.replaceAll("</script", "<\\/script");
const style = String(styles[0].source).replaceAll("</style", "<\\/style");
const template = await readFile(`${source}index.html`, "utf8");
const html = template
  .replace("<!-- library-styles -->", () => `<style>${style}</style>`)
  .replace(
    '<script type="module" src="./showcase.ts"></script>',
    () => `<script>${script}</script>`,
  );
const destination = `${root}artifacts/jank-ui-library.html`;
await mkdir(`${root}artifacts`, { recursive: true });
const temporary = `${destination}.${process.pid}.tmp`;
await writeFile(temporary, html);
await rename(temporary, destination);
console.log(`Built ${destination} (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`);
