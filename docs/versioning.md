# Versions and build identity

Each merged PR into main receives one semantic version bump after the check and
browser jobs pass. The PR title, description and commit messages are inspected:

- `fix:` is a patch bump; other changes without feature/breaking markers also
  receive a patch bump, so every merged PR is accounted for.
- `feat:` or `feat(scope):` is a minor bump.
- A conventional `!:` header or `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer
  is a major bump, including before 1.0.0.

The strongest signal wins within one PR. Multiple pending PRs are processed in
merge order, once each. `.release-state.json` records the last processed source
commit; `VERSION_HISTORY.md` records the version assigned to each PR. Keep both
files. Direct commits receive no independent bump.

The version job checks the merged source, prepares package.json and the history,
reruns project/package checks, then commits and atomically pushes main plus the
final `vX.Y.Z` tag. It never force-pushes. If main advances, the newer workflow
catches up the pending PRs. Build artifacts are produced again from the tagged
commit so their displayed commit is accurate. This does not publish to npm or
create a GitHub release.

Enable Actions write access for contents and allow the version job's bot to
update main/tags under your repository rules. The workflow declares only the
required write permission; it does not bypass branch protection. If your rules
require PR-only writes, configure an approved bot/app exception rather than
removing review requirements. No credentials or repository settings are changed
by adding this code. GitHub's built-in token prevents recursive push workflows.

`buildInfo` is a public, immutable export containing `version`, full `commit`
(or null when Git is unavailable), and `dirty`. Recording metadata takes its
version from the same source. The full panel footer and standalone viewer show
the version and short source commit; local uncommitted builds are marked. The
commit identifies the code actually built, not a later remote HEAD. Build values
are embedded with Vite and do not add runtime dependencies or Git/network calls.

Run `node --test scripts/release/*.test.mjs` for bump, duplicate and race checks.
`pnpm check` includes these tests. The publication integration test uses a temporary
local bare Git repository and a fake GitHub CLI; it does not contact a remote.
It runs on macOS/Linux (the publishing job uses Ubuntu); Windows still runs the
pure semantic-version tests.

References: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
[GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
