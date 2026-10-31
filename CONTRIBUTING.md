# Contributing

Jank's rewrite is a public source preview under the [MIT license](LICENSE). The profiler package
is `jank.js`; the independent UI package is `junkui`. Both retain registry-publication protection.
Start with the [README](README.md) and [preview compatibility](docs/public-preview.md).

## Set up

Use Node 24.22.1 and pnpm 11.24.0. Run `pnpm install --frozen-lockfile`, then
`pnpm exec playwright install chromium firefox webkit`. Linux machines may need
`pnpm exec playwright install --with-deps chromium firefox webkit` instead.
Installation builds junkui and configures the repository's pre-commit hook.

`pnpm dev:demo` serves the interactive demo on port 4187. Browser tests own port 4186; stop any
fixture server on that port before testing and run one browser suite at a time. Reference
comparison tools may optionally use an older checkout; normal builds and tests do not require it.

## Report a problem

Use the repository's issue tracker. Include the source revision from the panel/viewer footer,
browser and OS versions, renderer version and GPU when relevant, expected/actual behaviour,
and the smallest reproduction you can share. Distinguish real measurements from simulated demo
states. For GPU issues, include sampling settings, completeness and diagnostic rejection reasons.
A screenshot alone rarely identifies the clock or capture state that caused a problem.

Review recordings and logs before posting: host labels, counters, events and environment metadata
may contain information you do not want public. Prefer a minimal synthetic reproduction; do not
include credentials or private scene assets. For a potential security vulnerability, use GitHub's
private vulnerability reporting if available, rather than posting exploitable private details.

## Make a change

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md) and [quality policy](docs/quality.md).
Keep the host-owned frame loop, bounded storage, zero shipped runtime dependencies and truthful
unknown-measurement semantics. Keep renderer integrations optional and junkui independent.
Use labelled controls, accessible focus and reduced-motion behaviour. JSON is an interchange
format, not a substitute for structured authoring controls.

For implementation changes, write a behavioural regression, observe it fail, implement the
change and refactor with tests passing. Keep commits focused. Do not weaken coverage or lint
rules to accommodate a change; explain any necessary local suppression beside its invariant.

Run changed-file Biome fixes, `pnpm check` and `pnpm test:package`. The pre-commit hook runs the
last two commands. For collector/lifecycle changes, also run coverage, focused browser cases and
`pnpm bench`. UI changes need relevant browser, accessibility and visual checks. Use
`pnpm check:full` for the complete local release gate on macOS 26 arm64. Other platforms can run
`pnpm check`, `pnpm test:coverage`, `pnpm test:package` and `pnpm test:browser`; macOS CI checks
visual baselines. Inspect screenshot differences before accepting new baselines.

A pull request should describe the user-visible problem, resulting behaviour, relevant tests and
measurement limits. Include before/after screenshots for visual changes and matched evidence
for performance claims. Capability skips are not passes. Do not commit generated bundles, local
recordings or credentials. Versions are bumped deliberately; CI does not publish or increment them.
