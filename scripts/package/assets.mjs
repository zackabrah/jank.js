import { readdir, readFile, writeFile } from "node:fs/promises";

// Styles now live inside the panel's Shadow DOM. These exports stay so existing imports keep working.
const empty = "/* Empty compatibility stylesheet: jank.js styles live inside its Shadow DOM. */\n";
await Promise.all([
  writeFile("dist-package/style.css", empty),
  writeFile("dist-package/font.css", empty),
]);

// TypeScript leaves source extensions in declaration specifiers. Publish conventional
// .js specifiers, which resolve to the adjacent .d.ts in downstream TypeScript versions.
const files = await readdir("dist-package/types", { recursive: true });

await Promise.all(
  files
    .filter((file) => file.endsWith(".d.ts"))
    .map(async (file) => {
      const path = `dist-package/types/${file}`;
      const source = await readFile(path, "utf8");
      await writeFile(path, source.replace(/(from\s+["'][^"']+)\.tsx?(["'])/g, "$1.js$2"));
    }),
);
