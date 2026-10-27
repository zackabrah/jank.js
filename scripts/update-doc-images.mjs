import assert from "node:assert/strict";

import { copyFile, readdir } from "node:fs/promises";

// The manual's images are the board screenshots the Chromium browser tests take.
const images = (await readdir("docs/images")).filter((name) =>
  name.endsWith(".png"),
);

const taken = new Set(await readdir("artifacts/screenshots"));

const missing = images.filter((name) => !taken.has(name));

assert.equal(
  missing.length,
  0,
  `Missing screenshots: ${missing.join(", ")}. Run the Chromium browser tests first.`,
);

await Promise.all(
  images.map((name) =>
    copyFile(`artifacts/screenshots/${name}`, `docs/images/${name}`),
  ),
);

console.log(
  `Updated ${images.length} manual images from artifacts/screenshots.`,
);
