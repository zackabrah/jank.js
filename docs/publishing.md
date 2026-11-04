# Publishing to npm

The package is `jank.js`, published publicly to `https://registry.npmjs.org/`
with the `latest` dist-tag. Runtime dependencies remain zero. Publishing is
manual; merging a PR or creating a version tag does not publish a package.

The current `v1` branch is `1.0.0-rc.0` for local builds and packed consumer tests.
The publication workflow still rejects prerelease versions. Merging the candidate
promotes its version to `1.0.0`; publishing an RC would first require explicit
prerelease support and a non-`latest` npm tag.

## Prepare without publishing

Use Node 22.14+ and pnpm 11.24.0. The workflow pins npm 11.20.0, which supports
npm trusted publishing. From a clean checkout of the intended release:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox webkit
pnpm release:prepare
```

This runs `pnpm check:full` and writes `artifacts/npm/jank.js-X.Y.Z.tgz`.
It does not log in, publish, push or create a tag. Inspect the archive before
publishing; use its exact filename in these commands:

```sh
tar -tzf artifacts/npm/jank.js-X.Y.Z.tgz
npm publish ./artifacts/npm/jank.js-X.Y.Z.tgz --dry-run --ignore-scripts
```

The package allowlist includes the built library, optional adapters, TypeScript
declarations, empty compatibility stylesheets, offline viewer, license notices and selected project
documents. Source checkouts, test fixtures, screenshots, CI scripts and private
demo content are not shipped. A dry run checks packaging, not npm ownership or
permission to publish.

## Configure GitHub releases

The package is on npm, with 0.3.0 as `latest`. Configure a GitHub Actions trusted
publisher in its settings on npm:

- Organization or user: `zackabrah`
- Repository: `jank.js`
- Workflow filename: `publish.yml`
- Environment: `npm`
- Allowed action: direct `npm publish`

Create the matching `npm` environment in the GitHub repository. Environment
protection rules may be used to require a release reviewer; allow the version
tags used for releases. No `NPM_TOKEN` secret is required. Configure trust when
the next release is ready: a new npm trust configuration expires if it does not
complete its first successful publication within two days.

Public packages built in public repositories receive provenance automatically
through npm OIDC.

## Run the manual workflow

Merge `.github/workflows/publish.yml` into main before using it. In GitHub Actions,
open **Publish npm package**, choose **Run workflow**, and select the existing
`vX.Y.Z` tag in **Use workflow from**. Keep **dry_run** enabled for the first run.
The tag must include this workflow and match `package.json`.

The workflow rejects branch dispatches, mismatched tags, commits outside main,
dirty source and stale build identities. It installs the pinned tools, runs the
full release gate, packs the archive, previews publication and uploads the
tarball as a workflow artifact. Selecting the tag as the workflow ref also keeps
GitHub's source identity aligned with the built commit.

Review the successful run and artifact. To publish, run the same workflow from
the same tag with **dry_run** disabled. It repeats verification and publishes the
tarball produced in that run. Concurrent publishing runs are serialized. npm
rejects a version that already exists; rerunning a successful publication does
not bump or overwrite it. Only stable `X.Y.Z` releases are supported here.

Version tags created by the version job do not trigger this workflow. See
[versioning](versioning.md) for how merged PRs receive versions.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites),
[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
