# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```sh
pnpm dev                 # preview on :5173, with review pages at /checks/*.html
pnpm fix                 # Biome format and lint fixes
pnpm check               # boundary, lint, knip, node + unit tests with coverage floors, typecheck, build
pnpm test:package        # the packed tarball in a clean consumer
pnpm check:full          # check + test:package + test:e2e (release gate)

pnpm exec vitest run src/live/model.test.ts           # one unit test file
pnpm exec vitest run src/live/model.test.ts -t "name" # one unit test
node --test scripts/release/semver.test.mjs           # one script test (these run under node:test, not Vitest)

pnpm test:e2e e2e/panel.spec.ts --project=chromium    # one browser spec in one engine
pnpm test:e2e:gpu        # real GPU timing in Chrome on this hardware
pnpm bench               # per-frame overhead of the built panel

pnpm -s jank analyze <file>   # short JSON report from a recording, from source (needs Node 22.18+)
```

- The pre-commit hook runs `pnpm check`, `pnpm test:package` and the whole browser suite, then stages redrawn README chips. A commit takes minutes, so give it a long timeout. `--no-verify` skips the hook.
- `pnpm test:e2e` starts its own Vite server on port 4178 and runs Chromium, Firefox and WebKit. `e2e/package.spec.ts` is skipped unless `pnpm build:package` has run.
- `pnpm check` fails on coverage below the floors in `vite.config.ts`, and on unused exports and files through knip.
- Commit messages are Conventional Commits. The version bump on merge is derived from them (`docs/versioning.md`).
- Biome skips more than `src/core`: also `src/types`, `src/performance`, `src/index.ts`, the older adapters, `scripts` and `docs` (see `biome.json`).

## Architecture

`docs/architecture.md` is the detailed behaviour reference; `docs/measurements.md` defines what each number means.

**The host owns the loop.** Nothing here starts a frame loop. The host calls `monitor.beginFrame(at)`, `panel.refresh(at)` and `monitor.endFrame(...)` from its own `requestAnimationFrame`. Controllers advance only when the host calls them after each sealed frame. Importing a public entry must not touch the DOM.

**Layers**, from the bottom up:

- `src/core`: the collector (`createDiagnostics`), recording codec and preparation profiler. No Preact and no UI.
- `src/capture`, `src/compare`, `src/loading`, `src/gpu`: controllers and models over the collector. They take structural subsets of its types where possible, so they can be fed by any source. Comparison runs own the capture recorder while they run, which is why capture must be idle first.
- `src/live`, `src/viewer`, `src/ui`: Preact views. `src/live/diagnostics-adapter.ts` connects a collector to the panel and throttles rendering to 250 ms, with its own cost measured by `monitor.measureRefresh`. The panel and viewer mount in Shadow DOM through `src/shadow-view.ts`.
- `src/agent` and `cli`: `window.jank` and the `jank` command. `cli/analyze.ts` reuses `src/agent/analyze.ts` and the viewer's document parser.

**Missing is not zero.** `src/measurement.ts` separates measured values from explicit missing-data reasons, and this runs through models, views, recordings and comparison results. Unknown, partial, pending, rejected and measured zero stay distinct: never fill a gap with zero, interpolate across it or infer GPU completeness from counts. CPU submission time is not GPU time.

**Recordings** are version 2 with legacy version 1 imports, capped at 32 MiB (`src/core/recording.ts`, `src/recording/format.ts`). Comparisons are a `jank.js-comparison` envelope of nested recordings (`src/compare/model.ts`). `src/viewer/document.ts` dispatches between them, and imported summaries are never trusted: results are recomputed from the frames.

**Adding a public entry point** touches `package.json` exports, `vite.library.config.ts`, `tsconfig.package.json`, `scripts/package/verify.mjs` and the allowlist in `scripts/verify-boundary.mjs`, which rejects any unlisted top-level file in `src/`. The Vite `runtimeDependencyGuard` fails the build on third-party runtime code other than Preact. Public API and recording format changes also go in `CHANGELOG.md` and the docs.

**Review surfaces.** `checks/*.html` are development-only pages with labelled simulated hosts, and most browser specs drive them. `/checks/three.html` is the real Three.js host. `devtools/` holds the preview's sources and annotation tool. None of this ships.

**Styling.** Tailwind utilities map to the `--jank-*` tokens in `src/theme.css`, and default Tailwind colours and text sizes are removed. Write whole class strings, because `src/theme.test.ts` checks literal classes against the compiled CSS. A new component source may need adding to its stylesheet's `@source` list and to that test. V1 is desktop only, so verify UI at desktop widths. If the panel or viewer looks different, retake the README images with `pnpm docs:captures`; the hook does not do this.
