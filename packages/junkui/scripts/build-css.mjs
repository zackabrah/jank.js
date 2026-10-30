import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// The public stylesheet is standalone, including when linked without a bundler.
const entry = new URL("../src/junkui.css", import.meta.url);
const css = readFileSync(entry, "utf8").replaceAll(/@import "([^"]+)";/gu, (_import, path) =>
  readFileSync(new URL(path, entry), "utf8"),
);
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/styles.css", import.meta.url), css);
writeFileSync(new URL("../dist/styles.d.ts", import.meta.url), "export {};\n");
