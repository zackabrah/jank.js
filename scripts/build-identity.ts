import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Build-time only; shipped code never invokes Git or reads the filesystem. */
export function readBuildIdentity(directory = fileURLToPath(new URL("../", import.meta.url))) {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, {
        // Git hooks export repository/index paths; identify the requested directory instead.
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
        ),
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const commit = run(["rev-parse", "HEAD"]);
    const dirty = run(["status", "--porcelain", "--untracked-files=normal"]) !== "";
    return { commit, dirty, revision: `${commit.slice(0, 12)}${dirty ? "-dirty" : ""}` };
  } catch {
    return { commit: null, dirty: null, revision: "source" };
  }
}
