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

The `v1` branch is explicitly versioned `1.0.0-rc.1`, with opt-in npm publication
under the `beta` tag. Builds and packed consumers
carry that candidate identity. When an `X.Y.Z-rc.N` candidate reaches main through
a merged PR, its first version step promotes it to `X.Y.Z`, regardless of the PR's
bump marker, and switches `publishConfig.tag` from `beta` to `latest`. Subsequent merged PRs receive the normal bumps. This prevents the v1
breaking-change marker from skipping straight to 2.0.0. With no new merged PR,
the candidate version stays unchanged.

The version job checks the merged source, prepares package.json and the history,
reruns project/package checks, regenerates the README assets, then commits and atomically pushes main plus the
final `vX.Y.Z` tag. It never force-pushes. If main advances, the newer workflow
catches up the pending PRs. Build artifacts are produced again from the tagged
commit so their displayed commit is accurate. This does not publish to npm or
create a GitHub release.

The **Generate README assets** CI job uses unit/coverage reports from the Linux
check job and browser results from the same workflow run. It validates the report
completeness, generates chips and a versioned 1280 × 640 social card, and uploads
them as `readme-assets` for review on PRs. The version job reuses that run's browser
report and its own fresh unit/coverage results, then runs `pnpm docs:assets` again
after setting the release version. It commits `badge-*.svg`, `social-preview.svg`
and `social-preview.png` with the version and history, before creating the tag.

`social-preview.svg` remains the authored artwork; its `release-version` text is
generated, and Chromium renders the PNG. Size chips remain editorial estimates,
not measurements from this generation step. Screenshots still use `pnpm docs:captures`.
Generating the PNG does not upload it to GitHub's repository Social preview setting.

npm publication is a separate, manually dispatched workflow. See [npm publishing](publishing.md) for the initial account setup, dry runs and publishing an existing version tag. Versioning does not trigger it automatically.

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
It runs on macOS/Linux (the version job uses Ubuntu); Windows still runs the
pure semantic-version tests.

References: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
[GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
