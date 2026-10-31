import { readFileSync, writeFileSync } from "node:fs";

// Consume junkui's public asset once at build time; shipped jank has no runtime dependency.
const theme = readFileSync(new URL(import.meta.resolve("junkui/styles.css")), "utf8");
const panel = readFileSync(new URL("../src/panel/panel.css", import.meta.url), "utf8").replace(
  '@import "junkui/styles.css";',
  "",
);
const viewer = readFileSync(new URL("../src/viewer/viewer.css", import.meta.url), "utf8").replace(
  '@import "junkui/styles.css";',
  "",
);
writeFileSync(new URL("../dist/styles.css", import.meta.url), `${theme}\n${panel}\n${viewer}`);
writeFileSync(new URL("../dist/styles.d.ts", import.meta.url), "export {};\n");
