import { test } from "node:test";

import assert from "node:assert/strict";

import { execFileSync, spawnSync } from "node:child_process";

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";

import { tmpdir } from "node:os";

import { join, resolve } from "node:path";

// Git exports these to hooks, and in a linked worktree GIT_DIR names the real repository. Left
// set, every `git` below would commit, tag and configure there instead of in its temp repository.
for (const name of Object.keys(process.env))
  if (name.startsWith("GIT_")) delete process.env[name];

const script = resolve("scripts/release/verify-npm-release.mjs");

function fixture(t, version = "0.1.0", tag = "latest") {
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
      version,
      type: "module",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
        tag,
      },
    }),
  );

  writeFileSync(join(cwd, ".gitignore"), "dist-package/\n");

  git("add", ".");

  git("commit", "-m", "release source");

  git("tag", "-a", `v${version}`, "-m", "release");

  const commit = git("rev-parse", "HEAD");

  git("update-ref", "refs/remotes/origin/main", commit);

  git("update-ref", "refs/remotes/origin/v1", commit);

  const build = (buildInfo) => {
    mkdirSync(join(cwd, "dist-package"), { recursive: true });

    writeFileSync(
      join(cwd, "dist-package/index.js"),
      `export const buildInfo = ${JSON.stringify(buildInfo)};`,
    );
  };

  const output = join(cwd, ".git", "release-output");

  const verify = (ref = `refs/tags/v${version}`, args = []) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, GITHUB_REF: ref, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });

  return { cwd, git, commit, build, verify, output };
}

await test("accepts a clean annotated release tag on main and matching built identity", (t) => {
  const { commit, build, verify, output } = fixture(t);

  assert.equal(verify().status, 0);
  assert.equal(readFileSync(output, "utf8"), "dist_tag=latest\n");

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
    assert.match(result.stderr, /Run this workflow from the version tag/);
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

await test("accepts an RC tag from v1 outside main, with beta publication and matching identity", (t) => {
  const version = "1.0.0-rc.0";
  const { git, build, verify, output } = fixture(t, version, "beta");
  git("checkout", "-b", "v1");
  git("commit", "--allow-empty", "-m", "candidate changes");
  git("tag", "-f", `v${version}`);
  const commit = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/v1", commit);
  build({ version, commit, dirty: false });
  assert.equal(verify(undefined, ["--built"]).status, 0);
  assert.equal(readFileSync(output, "utf8"), "dist_tag=beta\n");
});

await test("rejects a candidate tag outside v1", (t) => {
  const { git, verify } = fixture(t, "1.0.0-rc.0", "beta");
  git("commit", "--allow-empty", "-m", "unreviewed source");
  git("tag", "-f", "v1.0.0-rc.0");
  assert.notEqual(verify().status, 0);
});

await test("rejects mismatched publication channels and unsupported prereleases", (t) => {
  for (const [version, tag] of [
    ["1.0.0-rc.0", "latest"],
    ["1.0.0", "beta"],
    ["1.0.0-rc.01", "beta"],
    ["1.0.0-alpha.0", "beta"],
  ]) {
    const { verify, output } = fixture(t, version, tag);
    assert.notEqual(verify().status, 0);
    assert.throws(() => readFileSync(output));
  }
});
