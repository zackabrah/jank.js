import { execFileSync } from "node:child_process";

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";

import { join } from "node:path";

import { planVersions } from "./semver.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const api = (path) =>
  JSON.parse(
    execFileSync("gh", ["api", path, "--paginate", "--slurp"], {
      encoding: "utf8",
    }),
  ).flat();

const output = (name, value) => {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REF !== "refs/heads/main"
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

const current = () =>
  git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0] === expected;

if (process.argv[2] === "plan") {
  output("changed", "false");

  if (!current()) {
    console.log(
      "Newer main commit exists; its run will catch up pending PR versions.",
    );

    process.exit(0);
  }

  if (git("rev-parse", "HEAD") !== expected)
    throw new Error("Checkout is not the checked commit");

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
    for (const pr of api(`repos/${repo}/commits/${sha}/pulls`)) {
      if (
        !pr.merged_at ||
        pr.base?.ref !== "main" ||
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
} else if (process.argv[2] === "publish") {
  output("created", "false");

  const plan = JSON.parse(readFileSync(planPath, "utf8"));

  if (plan.source !== expected || git("rev-parse", "HEAD") !== expected)
    throw new Error("Release plan does not match checkout");

  if (!current()) {
    console.log("Newer main commit exists; skipping this version write.");

    process.exit(0);
  }

  if (JSON.parse(readFileSync("package.json", "utf8")).version !== plan.version)
    throw new Error("Version changed after verification");

  git("add", "package.json", ".release-state.json", "VERSION_HISTORY.md");

  git("commit", "-m", `chore(release): v${plan.version}`);

  git("tag", `v${plan.version}`);

  // A concurrent merge causes a non-fast-forward rejection; never force-push.
  git(
    "push",
    "--atomic",
    "origin",
    "HEAD:refs/heads/main",
    `refs/tags/v${plan.version}`,
  );

  output("created", "true");

  output("commit", git("rev-parse", "HEAD"));

  output("version", plan.version);
} else throw new Error("Use plan or publish");
