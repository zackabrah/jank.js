import { test } from "node:test";

import assert from "node:assert/strict";

import { bumpKind, bumpVersion, planVersions } from "./semver.mjs";

const pr = (number, title) => ({
  number,
  title,
  base: { ref: "main" },
  merged_at: "2026-10-28",
  messages: [],
});

await test("conventional messages choose the strongest bump, including pre-1.0 breaking changes", () => {
  assert.equal(bumpKind(["fix: repair"]), "patch");
  assert.equal(bumpKind(["feat(panel): new view", "fix: repair"]), "minor");
  assert.equal(bumpKind(["feat!: remove API"]), "major");
  assert.equal(bumpKind(["refactor(core)!: remove API"]), "major");
  assert.equal(
    bumpKind(["feat: view\n\nBREAKING CHANGE: old API removed"]),
    "major",
  );
  assert.equal(bumpKind(["docs: wording"]), "patch");
  assert.equal(bumpVersion("0.9.3", "major"), "1.0.0");
  assert.equal(bumpVersion("2.4.9", "minor"), "2.5.0");
  assert.throws(() => bumpVersion("1.2.3-beta", "patch"));
});

await test("catch-up bumps once for each merged main PR in order, ignoring duplicates and unmerged PRs", () => {
  const plan = planVersions("0.1.0", [
    pr(1, "feat: first"),
    pr(1, "feat: first"),
    { ...pr(2, "feat!: pending"), merged_at: null },
    pr(3, "fix: next"),
    pr(4, "fix!: breaking"),
  ]);

  assert.deepEqual(
    plan.entries.map((e) => e.version),
    ["0.2.0", "0.2.1", "1.0.0"],
  );
  assert.equal(plan.version, "1.0.0");
  assert.deepEqual(planVersions("1.0.0", []).entries, []);
});
