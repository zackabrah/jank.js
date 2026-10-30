# jank.js readability rewrite

This branch contains the development stack, architecture, contracts, and a working public
profiler. `createProfiler` connects host frames, scopes, counters, events, GPU observations,
manual/automatic capture and a bounded archive. `parseRecording`, `serializeRecording` and
`RecordingError` provide validated version 3 files. `createPanel` provides LINE/MINI/FULL views,
live statistics, freeze, capture controls and local exports. Optional WebGL2 and Three r186
WebGPU adapters provide correlated GPU timing. The viewer and loading runtime remain pending.
`junkui` provides scoped native-control styles, neutral
theme tokens and accessible tabs. Both packages remain private during the rewrite.

- [Architecture and ownership](docs/architecture.md)
- [Code quality and enforcement](docs/quality.md)
- [Feature and verification plan](docs/rewrite-plan.md)
- [Implemented collection behavior and verification](docs/collection.md)
- [Recording format and validation](docs/recordings.md)
- [Live panel, integration and verification](docs/panel.md)
- [GPU adapters, ownership and measurement limits](docs/gpu-adapters.md)
- [Basic interactive demo and feature walkthrough](examples/basic/README.md)
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
pnpm bench:panel
```

`check` validates formatting, lint rules, types, browser-free core contracts, consumer examples,
tooling policy and unit/property tests. `test:package` builds the profiler and both packages'
declarations, then compiles and runs an isolated consumer without workspace sources.
`test:browser` exercises the host loop, recording download, tabs, native controls and axe checks
in Chromium, Firefox and WebKit. `test:visual` compares the gallery and panel's desktop/narrow screenshots
against macOS 26 arm64 baselines. Install those Playwright browsers if they are not available.

The pre-commit hook runs `check` and `test:package`. CI also runs coverage and browser tests on
Linux, plus visual comparisons on macOS 26 so native system fonts are compared on the same OS.
`pnpm install` configures `.githooks`; it does not stage generated artifacts or unrelated work.
It also builds the local junkui dependency so a clean checkout can resolve its public exports
before type-checking or running source fixtures. Run `pnpm test:package` before browser tests
to generate the built-package fixture's assets.

Run `pnpm dev:fixture` and open `http://127.0.0.1:4186/tests/fixtures/collection/` to exercise
collection, recording/export, clearing and disposal in a small host-owned animation loop.
This is a test fixture, not the redesigned live panel. Its [host code](tests/fixtures/collection/host.ts)
demonstrates the public API. `beginFrame` seals the preceding interval; stopping a recording
excludes the final open frame instead of inventing its ending boundary.

The independent gallery is at `http://127.0.0.1:4186/packages/junkui/gallery/` on the same server.
It demonstrates labelled fields, button states, keyboard tabs and control disposal/remounting.
The deterministic panel fixture is at `http://127.0.0.1:4186/tests/fixtures/panel/?mode=full`;
its host buttons advance simulated frames without adding a panel-owned animation loop.

Run `pnpm dev:demo` for the [basic Three.js scene](examples/basic/README.md) at
`http://127.0.0.1:4187/examples/basic/`. It uses real frame/CPU timings and renderer counters,
with controls for workload, deliberate hitches, recording, markers, errors and lifecycle.
The WebGL2 timer is connected by default; unsupported devices report unavailable timing.
Selectable simulated GPU states remain labelled examples. Loading and trace sources belong to the host.

The pinned development stack is retained. No old runtime code, UI CSS, screenshots or demo
assets were copied. Complete feature/visual parity and release gates arrive with
their implementation slices.
