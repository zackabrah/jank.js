# jank.js readability rewrite

This branch contains the development stack, architecture, contracts, and a working public
profiler. `createProfiler` connects host frames, scopes, counters, events, GPU observations,
manual/automatic capture and a bounded archive. `parseRecording`, `serializeRecording` and
`RecordingError` provide validated version 3 files. The panel, viewer, loading runtime,
renderer adapters remain pending. `junkui` now provides scoped native-control styles, neutral
theme tokens and accessible tabs. Both packages remain private during the rewrite.

- [Architecture and ownership](docs/architecture.md)
- [Code quality and enforcement](docs/quality.md)
- [Feature and verification plan](docs/rewrite-plan.md)
- [Implemented collection behavior and verification](docs/collection.md)
- [Recording format and validation](docs/recordings.md)
- [Independent UI package and gallery](packages/junkui/README.md)
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
pnpm test:visual
pnpm bench
```

`check` validates formatting, lint rules, types, browser-free core contracts, consumer examples,
tooling policy and unit/property tests. `test:package` builds the profiler and both packages'
declarations, then compiles and runs an isolated consumer without workspace sources.
`test:browser` exercises the host loop, recording download, tabs, native controls and axe checks
in Chromium, Firefox and WebKit. `test:visual` compares the gallery's desktop/narrow screenshots
against macOS 26 arm64 baselines. Install those Playwright browsers if they are not available.

The pre-commit hook runs `check` and `test:package`. CI also runs coverage and browser tests on
Linux, plus visual comparisons on macOS 26 so native system fonts are compared on the same OS.
`pnpm install` configures `.githooks`; it does not stage generated artifacts or unrelated work.

Run `pnpm dev:fixture` and open `http://127.0.0.1:4186/tests/fixtures/collection/` to exercise
collection, recording/export, clearing and disposal in a small host-owned animation loop.
This is a test fixture, not the redesigned live panel. Its [host code](tests/fixtures/collection/host.ts)
demonstrates the public API. `beginFrame` seals the preceding interval; stopping a recording
excludes the final open frame instead of inventing its ending boundary.

The independent gallery is at `http://127.0.0.1:4186/packages/junkui/gallery/` on the same server.
It demonstrates labelled fields, button states, keyboard tabs and control disposal/remounting.

The pinned development stack is retained. No old runtime code, UI CSS, screenshots or demo
assets were copied. Panel/viewer visual parity, optional adapter exports and release gates arrive with
their implementation slices.
