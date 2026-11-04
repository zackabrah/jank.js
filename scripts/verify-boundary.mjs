import assert from "node:assert/strict";

import { readdir, readFile } from "node:fs/promises";

const allowedSource = new Set([
  "index.ts",
  "panel-api.ts",
  "panel-api.test.ts",
  "public-recording.test.ts",
  "gpu-api.ts",
  "agent-api.ts",
  "agent",
  "core",
  "performance",
  "types",
  "adapters",
  "gpu",
  "recording",
  "capture",
  "compare",
  "live",
  "loading",
  "viewer",
  "ui",
  "assets",
  "format.ts",
  "format.test.ts",
  "frame-chart-geometry.ts",
  "measurement.ts",
  "measurement-value.tsx",
  "measurement-value.test.tsx",
  "shadow-view.ts",
  "shadow.css",
  "theme.css",
  // The development preview; none of these reach the published package.
  "app.tsx",
  "app.test.tsx",
  "main.tsx",
  "style.css",
  "theme.test.ts",
]);

for (const entry of await readdir("src")) {
  assert.ok(allowedSource.has(entry), `Unexpected public source: src/${entry}`);
}

for (const entry of await readdir(".")) {
  assert.ok(
    !["examples", "reference", "public", "comparison", "plugins", "Claude outputs"].includes(entry),
    `Private demo content must stay outside this repository: ${entry}`,
  );
}

const sourceFiles = await readdir("src", { recursive: true });

await Promise.all(
  sourceFiles.map(async (file) => {
    assert.ok(!/\.(glb|gltf|fbx|mp3|wav|ttf)$/i.test(file), `Demo asset: ${file}`);

    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) return;

    // Type-only imports erase at build time, so they cannot add a runtime dependency.
    const source = (await readFile(`src/${file}`, "utf8")).replace(/^import type [^;]+;$/gm, "");

    const imports = source.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g);

    for (const [, specifier] of imports) {
      // Preact is bundled into the panel and viewer; the core and adapters must stay free of it.
      const bundled = /^preact(\/|$)/.test(specifier) && !/^(core|adapters|types)[\\/]/.test(file);
      assert.ok(
        specifier.startsWith(".") || bundled,
        `Runtime dependency in ${file}: ${specifier}`,
      );
    }
  }),
);

const manifest = JSON.parse(await readFile("package.json", "utf8"));

assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
assert.equal(Object.keys(manifest.peerDependencies ?? {}).length, 0);

// npm links the package page and the README's relative links through these.
for (const [field, value] of Object.entries({
  homepage: manifest.homepage,
  "repository.url": manifest.repository?.url,
  "bugs.url": manifest.bugs?.url,
})) {
  assert.ok(typeof value === "string" && value.trim() !== "", `package.json needs ${field}`);
}

for (const dependency of ["gsap"]) {
  assert.ok(!(dependency in manifest.devDependencies), `Demo dependency: ${dependency}`);
}

console.log("Public boundary verified: tool-only source and zero runtime dependencies.");
