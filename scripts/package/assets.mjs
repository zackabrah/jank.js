import { readFile, writeFile } from "node:fs/promises";

import { build } from "vite";

// Bundle the token import and minify with the same CSS pipeline as the viewer.
const styles = await build({
  configFile: false,
  publicDir: false,
  build: {
    target: "es2023",
    write: false,
    cssMinify: "lightningcss",
    rolldownOptions: { input: "src/performance/tray.css" },
  },
});

const asset = "asset";

const stylesheet = styles.output.find(
  (file) => file.type === asset && file.fileName.endsWith(".css"),
);

if (!stylesheet) throw new Error("The panel CSS build emitted no stylesheet");

await writeFile("dist-package/style.css", stylesheet.source);

await writeFile(
  "dist-package/font.css",
  await readFile("src/performance/font.css", "utf8"),
);

// TypeScript leaves source extensions in declaration specifiers. Publish conventional
// .js specifiers, which resolve to the adjacent .d.ts in downstream TypeScript versions.
const { readdir } = await import("node:fs/promises");

const files = await readdir("dist-package/types", { recursive: true });

await Promise.all(
  files
    .filter((file) => file.endsWith(".d.ts"))
    .map(async (file) => {
      const path = `dist-package/types/${file}`;

      const source = await readFile(path, "utf8");

      await writeFile(
        path,
        source.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2"),
      );
    }),
);
