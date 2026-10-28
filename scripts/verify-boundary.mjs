import assert from "node:assert/strict";

import { readdir, readFile } from "node:fs/promises";

const allowedSource = new Set([
  "index.ts",
  "core",
  "performance",
  "types",
  "adapters",
  "viewer",
]);

for (const entry of await readdir("src")) {
  assert.ok(allowedSource.has(entry), `Unexpected public source: src/${entry}`);
}

for (const entry of await readdir(".")) {
  assert.ok(
    !["examples", "reference", "public", "Claude outputs"].includes(entry),
    `Private demo content must stay outside this repository: ${entry}`,
  );
}

const sourceFiles = await readdir("src", { recursive: true });

await Promise.all(
  sourceFiles.map(async (file) => {
    assert.ok(
      !/\.(glb|gltf|fbx|mp3|wav|ttf)$/i.test(file),
      `Demo asset: ${file}`,
    );

    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) return;

    const source = await readFile(`src/${file}`, "utf8");

    const imports = source.matchAll(
      /(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g,
    );

    for (const [, specifier] of imports) {
      assert.ok(
        specifier.startsWith("."),
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
  assert.ok(
    typeof value === "string" && value.trim() !== "",
    `package.json needs ${field}`,
  );
}

for (const dependency of ["gsap"]) {
  assert.ok(
    !(dependency in manifest.devDependencies),
    `Demo dependency: ${dependency}`,
  );
}

console.log(
  "Public boundary verified: tool-only source and zero runtime dependencies.",
);
