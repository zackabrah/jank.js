# jank.js readability rewrite

This branch contains the development stack, proposed architecture, and type contracts.
There is no profiler, panel, viewer, or UI runtime implementation yet. The packages are private
and export types only; they are not replacements for the existing package.

- [Architecture and ownership](docs/architecture.md)
- [Code quality and enforcement](docs/quality.md)
- [Feature and verification plan](docs/rewrite-plan.md)
- [jank.js public type contracts](packages/jank/src/index.ts)
- [junkui public type contracts](packages/junkui/src/index.ts)

The current application remains available in the original checkout. Its `eeed4c7` commit is
the historical starting point. Existing uncommitted changes there were not copied or modified
by this worktree. Use its manual, screenshots and browser fixtures as reference evidence.

## Workspace

`packages/jank` owns collection, recordings, analysis, the live panel, the offline viewer,
and optional renderer adapters. `packages/junkui` owns reusable native controls and the theme.
The UI package does not know that a profiler exists.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build:types
```

`check` validates formatting, lint rules, types, browser-free core contracts, consumer type
examples, and executable tooling-policy tests. `build:types` builds each package's declarations
independently. Runtime tests and a development app will arrive with implementation; none is
represented by a placeholder passing command.

The pre-commit hook runs these same gates. `pnpm install` configures the repository to use
`.githooks`; it does not stage generated artifacts or unrelated work.

The pinned Vite, Vitest, Playwright, axe, fast-check, Knip and benchmark dependencies are retained
for those later slices. No old runtime code, UI CSS, screenshots or demo assets were copied.
