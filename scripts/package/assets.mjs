import { copyFile, readFile, writeFile } from "node:fs/promises";

// One self-contained stylesheet: the tokens are the theming surface, inlined ahead of the panel.
const tokens = await readFile("src/performance/tokens.css", "utf8");

const panel = await readFile("src/performance/tray.css", "utf8");

await writeFile(
  "dist-package/style.css",
  panel.replace('@import "./tokens.css";', tokens),
);

await Promise.all(
  [400, 500, 600].map((weight) =>
    copyFile(
      `src/performance/ui/ibm-plex-mono-${weight}.woff2`,
      `dist-package/ibm-plex-mono-${weight}.woff2`,
    ),
  ),
);

await writeFile(
  "dist-package/font.css",
  (await readFile("src/performance/font.css", "utf8")).replaceAll(
    "./ui/ibm-plex-mono-",
    "./ibm-plex-mono-",
  ),
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
