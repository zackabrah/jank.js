import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";

import { readFileSync } from "node:fs";

import { resolve } from "node:path";

import { pathToFileURL } from "node:url";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));

/** Runs git and returns its trimmed stdout. */
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

assert.equal(manifest.name, "jank.js");
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
assert.equal(
  process.env.GITHUB_REF,
  `refs/tags/v${manifest.version}`,
  "Run this workflow from the vX.Y.Z tag matching package.json, not a branch",
);

const commit = git("rev-parse", "HEAD");

assert.equal(
  git("rev-parse", "--verify", `${process.env.GITHUB_REF}^{commit}`),
  commit,
  "The checkout must match the selected release tag",
);

git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");

assert.equal(
  git("status", "--porcelain"),
  "",
  "Release checkout must be clean",
);
assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
assert.equal(manifest.publishConfig?.access, "public");
assert.equal(manifest.publishConfig?.tag, "latest");

if (process.argv.includes("--built")) {
  const { buildInfo } = await import(
    pathToFileURL(resolve("dist-package/index.js")).href
  );

  assert.deepEqual(
    buildInfo,
    { version: manifest.version, commit, dirty: false },
    "The built package must identify the clean tagged source",
  );
}

console.log(
  `Verified npm release: ${manifest.name}@${manifest.version} (${commit})`,
);
