import { readFileSync } from "node:fs";

import { execFileSync } from "node:child_process";

/** Package version plus the Git commit and whether tracked files are modified; commit is null outside Git. */
export function readBuildInfo() {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));

  let commit = null,
    dirty = false;

  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    dirty =
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=no", "--", "."],
        { encoding: "utf8" },
      ).trim().length > 0;
  } catch {
    /* Source archives can be built without Git. */
  }

  return { version, commit, dirty };
}
