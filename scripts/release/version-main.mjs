import { execFileSync } from "node:child_process";

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";

import { join } from "node:path";

import { mainBranch, planVersions } from "./semver.mjs";

const mainRef = `refs/heads/${mainBranch}`;

/** The only run allowed to write versions: a GitHub Actions push to main. */
const versionRun = { actions: "true", event: "push", ref: mainRef };

const step = { plan: "plan", prepare: "prepare", tag: "tag" };

/** Runs git and returns its trimmed stdout. */
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** Fetches every page of a GitHub API list through gh and flattens the pages. */
const api = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", path, "--paginate", "--slurp"], {
      encoding: "utf8",
    }),
  ).flat();

/** Sets a step output for later workflow steps; a no-op outside Actions. */
const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

if (
  process.env.GITHUB_ACTIONS !== versionRun.actions ||
  process.env.GITHUB_EVENT_NAME !== versionRun.event ||
  process.env.GITHUB_REF !== versionRun.ref
)
  throw new Error(
    "Version writes run only in the main push workflow; use semver tests locally.",
  );

const expected = process.env.GITHUB_SHA;

const repo = process.env.GITHUB_REPOSITORY;

if (!expected || !repo) throw new Error("Missing GitHub commit/repository");

const temp = process.env.RUNNER_TEMP;

if (!temp) throw new Error("RUNNER_TEMP is required");

mkdirSync(temp, { recursive: true });

const planPath = join(temp, "semantic-version-plan.json");

/** True while this run's commit is still the tip of main on the remote. */
const current = () =>
  git("ls-remote", "origin", mainRef).split(/\s/)[0] === expected;

if (git("rev-parse", "HEAD") !== expected)
  throw new Error("Checkout is not the checked commit");

if (process.argv[2] === step.plan) {
  output("changed", "false");

  if (!current()) {
    console.log(
      "Newer main commit exists; its run will catch up pending PR versions.",
    );

    process.exit(0);
  }

  const state = JSON.parse(readFileSync(".release-state.json", "utf8"));

  git("merge-base", "--is-ancestor", state.lastSourceCommit, expected);

  const commits = git(
    "rev-list",
    "--first-parent",
    "--reverse",
    `${state.lastSourceCommit}..${expected}`,
  )
    .split("\n")
    .filter(Boolean);

  const prs = [];

  const seen = new Set();

  for (const sha of commits) {
    // A release PR records bumps for earlier source PRs.
    if (git("diff", "--name-only", sha + "^1", sha, "--", ".release-state.json"))
      continue;

    for (const pr of api(`repos/${repo}/commits/${sha}/pulls`)) {
      if (
        !pr.merged_at ||
        pr.base?.ref !== mainBranch ||
        pr.merge_commit_sha !== sha ||
        seen.has(pr.number)
      )
        continue;

      seen.add(pr.number);

      const messages = api(`repos/${repo}/pulls/${pr.number}/commits`).map(
        (c) => c.commit.message,
      );

      prs.push({ ...pr, messages });
    }
  }

  const manifest = JSON.parse(readFileSync("package.json", "utf8"));

  const plan = { ...planVersions(manifest.version, prs), source: expected };

  if (!plan.entries.length) {
    console.log("No unversioned merged PRs.");

    process.exit(0);
  }

  manifest.version = plan.version;

  manifest.publishConfig.tag = "latest";

  writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");

  writeFileSync(
    ".release-state.json",
    JSON.stringify({ lastSourceCommit: expected }, null, 2) + "\n",
  );

  const previous = readFileSync("VERSION_HISTORY.md", "utf8");

  const entries = plan.entries
    .toReversed()
    .map(
      (e) =>
        `- ${e.version} — ${e.kind} — PR #${e.number}: ${e.title.replace(/[\r\n]/g, " ")}`,
    )
    .join("\n");

  writeFileSync(
    "VERSION_HISTORY.md",
    previous.replace("<!-- versions -->", `<!-- versions -->\n\n${entries}`),
  );

  writeFileSync(planPath, JSON.stringify(plan));

  output("changed", "true");

  output("version", plan.version);

  console.log(`Prepared ${plan.entries.length} PR bumps: ${plan.version}`);
} else if (process.argv[2] === step.prepare) {
  output("prepared", "false");

  const plan = JSON.parse(readFileSync(planPath, "utf8"));

  if (plan.source !== expected)
    throw new Error("Release plan does not match checkout");

  if (!current()) {
    console.log("Newer main commit exists; skipping this version write.");

    process.exit(0);
  }

  if (JSON.parse(readFileSync("package.json", "utf8")).version !== plan.version)
    throw new Error("Version changed after verification");

  const branch = "release/v" + plan.version + "-" + expected;
  const ref = "refs/heads/" + branch;
  if (!git("ls-remote", "origin", ref)) {
    git("add", "package.json", ".release-state.json", "VERSION_HISTORY.md",
      "docs/readme/badge-*.svg", "docs/readme/social-preview.svg", "docs/readme/social-preview.png");

    // The workflow requires passing check/browser jobs and rechecks the versioned
    // package before this step. Developer hooks would repeat browser tests on a
    // runner and could stage unrelated changes. CI explicitly regenerates the release assets.
    git("commit", "--no-verify", "-m", `chore(release): v${plan.version}`);

    git("push", "origin", "HEAD:" + ref);
  }

  output("prepared", "true");
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  output("url", server + "/" + repo + "/compare/" + mainBranch + "..." + branch + "?expand=1");
} else if (process.argv[2] === step.tag) {
  output("created", "false");

  // Recover the exact release merge if its workflow was superseded.
  const commit = git("log", "-1", "--first-parent", "--format=%H", "--", ".release-state.json");
  if (!commit || git("rev-list", "--parents", "-1", commit) === commit)
    process.exit(0);

  const release = JSON.parse(git("show", commit + ":package.json"));
  const parent = JSON.parse(git("show", commit + "^1:package.json"));
  if (release.version === parent.version || release.publishConfig.tag !== "latest")
    process.exit(0);

  const ref = "refs/tags/v" + release.version;
  const existing = git("ls-remote", "origin", ref, ref + "^{}");
  if (existing) {
    const tagged = existing.split("\n").at(-1).split(/\s/)[0];
    if (tagged !== commit) throw new Error(ref + " already points to " + tagged);
  } else {
    git("push", "origin", commit + ":" + ref);
    git("fetch", "origin", ref + ":" + ref);
  }

  output("created", "true");
  output("commit", commit);
  output("version", release.version);
} else throw new Error("Use plan, prepare or tag");
