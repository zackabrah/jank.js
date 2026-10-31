import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBuildIdentity } from "../../scripts/build-identity.ts";

test("build identity distinguishes committed, modified and unavailable source", () => {
  const directory = mkdtempSync(join(tmpdir(), "jank-build-identity-"));
  try {
    assert.equal(readBuildIdentity(directory).revision, "source");
    const git = (...args) =>
      execFileSync("git", args, {
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
        ),
        cwd: directory,
        stdio: "pipe",
        encoding: "utf8",
      }).trim();
    git("init");
    writeFileSync(join(directory, "source.txt"), "first");
    git("add", "source.txt");
    git(
      "-c",
      "user.name=Build test",
      "-c",
      "user.email=build-test@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
    const commit = git("rev-parse", "HEAD");
    assert.deepEqual(readBuildIdentity(directory), {
      commit,
      dirty: false,
      revision: commit.slice(0, 12),
    });
    writeFileSync(join(directory, "source.txt"), "changed");
    assert.deepEqual(readBuildIdentity(directory), {
      commit,
      dirty: true,
      revision: `${commit.slice(0, 12)}-dirty`,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
