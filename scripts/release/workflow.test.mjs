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
        JSON.stringify({ version: "0.1.0" }) + "\n",
      );

      writeFileSync(
        join(repo, "VERSION_HISTORY.md"),
        "# Versions\n\n<!-- versions -->\n",
      );

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

      run(process.execPath, [script, "publish"], repo, env);

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
