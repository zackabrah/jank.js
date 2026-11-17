import { test } from "node:test";

import assert from "node:assert/strict";

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { join, resolve, delimiter } from "node:path";

import { execFileSync } from "node:child_process";

// Git exports these to hooks, and in a linked worktree GIT_DIR names the real repository. Left
// set, every `git` below would commit, tag and configure there instead of in its temp repository.
for (const name of Object.keys(process.env))
  if (name.startsWith("GIT_")) delete process.env[name];

const run = (cmd, args, cwd, env = process.env) =>
  execFileSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

await test(
  "version publication is atomic, reruns do not double-bump, and newer main wins",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "semver-workflow-"));

    const repo = join(root, "repo"),
      remote = join(root, "remote.git"),
      bin = join(root, "bin");

    mkdirSync(repo);

    mkdirSync(bin);

    const script = resolve("scripts/release/version-main.mjs");

    const git = (...args) => run("git", args, repo);

    try {
      run("git", ["init", "--bare", remote], repo);

      git("init", "-b", "main");

      git("config", "user.name", "Version test");

      git("config", "user.email", "version@example.invalid");

      writeFileSync(
        join(repo, "package.json"),
        JSON.stringify({ version: "0.2.0-rc.0", publishConfig: { tag: "beta" } }) + "\n",
      );

      writeFileSync(
        join(repo, "VERSION_HISTORY.md"),
        "# Versions\n\n<!-- versions -->\n",
      );

      mkdirSync(join(repo, "docs/readme"), { recursive: true });
      const assets = ["badge-version.svg", "badge-unit.svg", "social-preview.svg", "social-preview.png"];
      for (const name of assets)
        writeFileSync(join(repo, "docs/readme", name), "old asset");
      writeFileSync(join(repo, "docs/readme/panel.png"), "original screenshot");

      git("add", ".");

      git("commit", "-m", "baseline");

      const base = git("rev-parse", "HEAD");

      writeFileSync(
        join(repo, ".release-state.json"),
        JSON.stringify({ lastSourceCommit: base }) + "\n",
      );

      git("add", ".");

      git("commit", "-m", "set baseline");

      git("remote", "add", "origin", remote);

      git("push", "-u", "origin", "main");

      const gh = `#!/usr/bin/env node
const path=process.argv[3];
const pr={number:1,title:'feat: feature',base:{ref:'main'},merged_at:'2026-10-28',merge_commit_sha:process.env.GITHUB_SHA};
console.log(JSON.stringify(path.endsWith('/pulls') ? [path.includes(process.env.GITHUB_SHA)?[pr]:[]] : [[{commit:{message:'feat: feature'}}]]));
`;

      writeFileSync(join(bin, "gh"), gh, { mode: 0o755 });

      git("commit", "--allow-empty", "-m", "feat: feature");

      git("push");

      const sha = git("rev-parse", "HEAD");

      const output = join(root, "outputs");

      const env = {
        ...process.env,
        PATH: bin + delimiter + process.env.PATH,
        GITHUB_ACTIONS: "true",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: sha,
        GITHUB_REPOSITORY: "fixture/tool",
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: root,
      };

      run(process.execPath, [script, "plan"], repo, env);

      assert.equal(
        JSON.parse(readFileSync(join(repo, "package.json"))).version,
        "0.2.0",
      );

      assert.equal(
        JSON.parse(readFileSync(join(repo, "package.json"))).publishConfig.tag,
        "latest",
      );

      // CI already ran its required gates. A developer hook must neither repeat them
      // on the version runner nor stage unrelated generated files in the release.
      const hook = join(repo, ".git", "hooks", "pre-commit");

      writeFileSync(hook, "#!/bin/sh\necho developer-hook >&2\nexit 1\n", {
        mode: 0o755,
      });

      // Stand in for CI's regenerated assets; unrelated screenshots must stay out of the tag.
      for (const name of assets)
        writeFileSync(join(repo, "docs/readme", name), `generated ${name} for 0.2.0`);
      writeFileSync(join(repo, "docs/readme/panel.png"), "unrelated change");

      run(process.execPath, [script, "publish"], repo, env);

      for (const name of assets)
        assert.equal(git("show", `v0.2.0:docs/readme/${name}`), `generated ${name} for 0.2.0`);
      assert.equal(git("show", "v0.2.0:docs/readme/panel.png"), "original screenshot");
      git("restore", "docs/readme/panel.png");

      // Only the automated version commit bypasses the hook; local commits retain it.
      assert.throws(
        () => git("commit", "--allow-empty", "-m", "local commit"),
        /developer-hook/,
      );

      rmSync(hook);

      assert.equal(git("rev-parse", "v0.2.0"), git("rev-parse", "HEAD"));
      assert.equal(
        git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0],
        git("rev-parse", "HEAD"),
      );

      run(process.execPath, [script, "plan"], repo, env);

      assert.equal(
        JSON.parse(readFileSync(join(repo, "package.json"))).version,
        "0.2.0",
      );

      git("commit", "--allow-empty", "-m", "feat: second");

      git("push");

      env.GITHUB_SHA = git("rev-parse", "HEAD");

      run(process.execPath, [script, "plan"], repo, env);

      const newer = join(root, "newer");

      run("git", ["clone", "-b", "main", remote, newer], repo);

      run(
        "git",
        [
          "-c",
          "user.name=Version test",
          "-c",
          "user.email=version@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "feat: newer merge",
        ],
        newer,
      );

      run("git", ["push"], newer);

      const remoteHead = git("ls-remote", "origin", "refs/heads/main");

      run(process.execPath, [script, "publish"], repo, env);

      assert.equal(git("ls-remote", "origin", "refs/heads/main"), remoteHead);
      assert.equal(git("rev-parse", "HEAD"), env.GITHUB_SHA);
      assert.match(readFileSync(output, "utf8"), /created=false\n$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
