# jank.js readability rewrite

This branch contains the development stack, architecture, contracts, and a working public
profiler. `createProfiler` connects host frames, scopes, counters, events, GPU observations,
manual/automatic capture and a bounded archive. `parseRecording`, `serializeRecording` and
`RecordingError` provide validated version 3 files. The panel, viewer, loading runtime,
renderer adapters and UI runtime remain pending. Packages remain private; `junkui` exports
types only until its implementation slice.

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
tooling policy and unit/property tests. `test:package` builds the profiler and both packages'
declarations, then compiles and runs an isolated consumer without workspace sources.
`test:browser` exercises the host loop and recording download in Chromium, Firefox and WebKit.
Install those Playwright browsers if they are not available.

The pre-commit hook runs `check` and `test:package`. CI also runs coverage and browser tests.
`pnpm install` configures `.githooks`; it does not stage generated artifacts or unrelated work.

Run `pnpm dev:fixture` and open `http://127.0.0.1:4186/tests/fixtures/collection/` to exercise
collection, recording/export, clearing and disposal in a small host-owned animation loop.
This is a test fixture, not the redesigned live panel. Its [host code](tests/fixtures/collection/host.ts)
demonstrates the public API. `beginFrame` seals the preceding interval; stopping a recording
excludes the final open frame instead of inventing its ending boundary.

The pinned development stack is retained. No old runtime code, UI CSS, screenshots or demo
assets were copied. UI/accessibility, optional adapter exports and release gates arrive with
their implementation slices.
