# jank.js readability rewrite

This branch contains the development stack, proposed architecture, type contracts, and the
first internal measurement implementation. The collector handles frames, scopes, bounded
history, snapshots and overhead. An internal capture controller owns recording windows and
the saved archive. The public profiler, panel, viewer and UI runtime are still pending.
Packages remain private. `jank.js` now exports
`parseRecording`, `serializeRecording` and `RecordingError`; `junkui` still exports types only.

- [Architecture and ownership](docs/architecture.md)
- [Code quality and enforcement](docs/quality.md)
- [Feature and verification plan](docs/rewrite-plan.md)
- [Implemented collection behavior and verification](docs/collection.md)
- [Recording format and validation](docs/recordings.md)
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
pnpm test:coverage
pnpm test:package
pnpm test:browser
pnpm bench
```

`check` validates formatting, lint rules, types, browser-free core contracts, consumer examples,
tooling policy and unit/property tests. `test:package` builds both declaration packages and
compiles an isolated consumer and exercises the built recording codec. `test:browser` exercises the host loop
in Chromium, Firefox and WebKit. Install those Playwright browsers if they are not available.

The pre-commit hook runs `check` and `test:package`. CI also runs coverage and browser tests.
`pnpm install` configures `.githooks`; it does not stage generated artifacts or unrelated work.

Run `pnpm dev:fixture` and open `http://127.0.0.1:4186/tests/fixtures/collection/` to exercise
collection, clearing and disposal in a small host-owned animation loop. This is a test fixture,
not the redesigned live panel.

The pinned development stack is retained. No old runtime code, UI CSS, screenshots or demo
assets were copied. UI/accessibility, packaged runtime exports and release gates arrive with
their implementation slices.
