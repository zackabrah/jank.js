# Contributing

Use Node 22.12+ and pnpm 11.24.0. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. Keep `pnpm-lock.yaml` in version control. Dependencies are pinned to exact versions; update them deliberately and verify with `pnpm check:full`.

Before submitting a change, run `pnpm lint:fix`, `pnpm format`, and `pnpm check`. Run `pnpm test:package` for public API, packaging or stylesheet changes. For UI, lifecycle, recording and adapter changes, install the Playwright browsers and run `pnpm build` followed by the relevant `pnpm test:e2e` cases. Browser tests target the built viewer and packaged panel fixtures, not the development server. They save the user manual's screenshots to `artifacts/screenshots`; run `pnpm docs:images` to refresh `docs/images` when a change alters what they show. The full release gate is `pnpm check:full`.

Keep a blank line between every statement, including function declarations. `pnpm format` inserts these lines with Oxlint's `@stylistic/padding-line-between-statements` rule before running Oxfmt, which preserves them. `pnpm format:check` and `pnpm lint` enforce the same rule.

Keep runtime dependencies at zero unless a documented benefit justifies a change. Framework-specific adapters must remain optional. The host owns simulation/rendering clocks, GPU resources and renderer settings. Avoid allocating in frame collection without measuring the cost. Run `pnpm bench` when changing collection or refresh behavior, and report the environment and measurement limits with results.

Package JavaScript is minified with Vite's Oxc minifier, including internal identifier mangling. Public exports and property names remain stable. Vite preserves the annotations and whitespace needed for tree shaking in ES library builds; consuming applications can compact the final bundle further. Source maps remain available for debugging. The offline viewer is also minified. This makes distributed code smaller and less readable, but does not hide the source or provide code protection.

For npm release preparation, use `pnpm release:prepare` from a clean checkout. It runs the full release gate and writes a tarball to `artifacts/npm` without publishing. Maintainers should follow [the npm publishing guide](https://github.com/zackabrah/jank.js/blob/main/docs/publishing.md) for first-publish setup and the manual release workflow.

Use labelled fields, selectors and buttons for authoring controls. JSON is an export format, not an authoring interface. Preserve keyboard operation, scoped styles, cleanup and unavailable measurements. Don't claim GPU timings based on CPU submission durations.

Tests should exercise behavioral risks: lifecycle, delayed GPU samples, recording boundaries, overlapping work and package consumers. Keep commits focused and verified. Include the problem, behavior change and checks in a pull request; do not publish packages or deploy a site as part of an ordinary code change.

Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). After staging, `pnpm commit` composes one with commitizen; confirming a breaking change there adds `!` to the header. Each merged PR receives one version bump from its title, description and commit messages: a breaking change is major, `feat` is minor and anything else is a patch. See [the versioning guide](https://github.com/zackabrah/jank.js/blob/main/docs/versioning.md).

Report bugs with browser/OS, reproduction steps, expected and actual behavior, and an optional recording stripped of private application labels or values. The library has no telemetry. New public API behavior and recording-format changes belong in CHANGELOG.md and docs.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
