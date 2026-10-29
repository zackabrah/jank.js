import { test } from "node:test";

import assert from "node:assert/strict";

import { execFileSync, spawnSync } from "node:child_process";

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join, resolve } from "node:path";

const script = resolve("scripts/release/verify-npm-release.mjs");

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "npm-release-"));

  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

  git("init", "-b", "main");

  git("config", "user.name", "Release test");

  git("config", "user.email", "release@example.invalid");

  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "jank.js",
      version: "0.1.0",
      type: "module",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
        tag: "latest",
      },
    }),
  );

  writeFileSync(join(cwd, ".gitignore"), "dist-package/\n");

  git("add", ".");

  git("commit", "-m", "release source");

  git("tag", "-a", "v0.1.0", "-m", "release");

  const commit = git("rev-parse", "HEAD");

  git("update-ref", "refs/remotes/origin/main", commit);

  const build = (buildInfo) => {
    mkdirSync(join(cwd, "dist-package"), { recursive: true });

    writeFileSync(
      join(cwd, "dist-package/index.js"),
      `export const buildInfo = ${JSON.stringify(buildInfo)};`,
    );
  };

  const verify = (ref = "refs/tags/v0.1.0", args = []) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, GITHUB_REF: ref },
      encoding: "utf8",
    });

  return { cwd, git, commit, build, verify };
}

await test("accepts a clean annotated release tag on main and matching built identity", (t) => {
  const { commit, build, verify } = fixture(t);

  assert.equal(verify().status, 0);

  build({ version: "0.1.0", commit, dirty: false });

  assert.equal(verify("refs/tags/v0.1.0", ["--built"]).status, 0);
});

await test("rejects branch dispatches and tags that do not match the package version", (t) => {
  const { verify } = fixture(t);

  for (const ref of [
    "refs/heads/main",
    "refs/tags/v0.2.0",
    "refs/tags/v0.1.0-beta.1",
  ]) {
    const result = verify(ref);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Run this workflow from the vX.Y.Z tag/);
  }
});

await test("rejects a checkout different from the selected tag", (t) => {
  const { git, verify } = fixture(t);

  git("commit", "--allow-empty", "-m", "newer source");

  const result = verify();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout must match the selected release tag/);
});

await test("rejects a tagged commit that has not reached main", (t) => {
  const { git, verify } = fixture(t);

  git("checkout", "-b", "unmerged");

  git("commit", "--allow-empty", "-m", "unmerged source");

  git("tag", "-f", "v0.1.0");

  assert.notEqual(verify().status, 0);
});

await test("rejects tracked edits and untracked release inputs", (t) => {
  for (const file of ["package.json", "unexpected.js"]) {
    const { cwd, verify } = fixture(t);

    const path = join(cwd, file);

    writeFileSync(path, file === "package.json" ? "\n" : "export {};", {
      flag: "a",
    });

    const result = verify();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release checkout must be clean/);
  }
});

await test("rejects stale versions, stale commits and dirty build artifacts", (t) => {
  const { commit, build, verify } = fixture(t);

  for (const identity of [
    { version: "0.0.9", commit, dirty: false },
    { version: "0.1.0", commit: "0".repeat(40), dirty: false },
    { version: "0.1.0", commit, dirty: true },
  ]) {
    build(identity);

    const result = verify("refs/tags/v0.1.0", ["--built"]);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /built package must identify the clean tagged source/,
    );
  }
});
