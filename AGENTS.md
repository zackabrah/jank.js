# jank.js

This is the independent public performance tool. Keep private demonstration scenes, artwork, audio, server configuration and history out of this repository. Keep nothing to install at runtime (Preact is bundled into the panel and viewer, and the core and adapters stay free of it), host-owned frame loops and optional renderer adapters. The recording viewer and small automated test fixtures belong to the tool. Reference checkouts are read-only.

Use pnpm 11.24.0 and the pinned tooling. Run pnpm fix, then pnpm check. Run pnpm test:package for exports/assets and focused Playwright cases for UI, lifecycle or recording changes. pnpm check:full is the release gate. State measurement limits for collection or refresh changes.

Keep commits focused and verified. Do not push, publish or deploy unless requested. Never invent repository or registry URLs. Use labelled controls, not raw JSON authoring fields.

The collector in `src/core` is deliberately outside Biome for now, so it stays close to 0.3.0 (only deliberate fixes, no reformatting) until it can be brought under the formatter in its own change. See `docs/architecture.md` for how the panel and viewer behave.

## Performance Analysis

To analyze a recording, compare two builds or drive a running host from a script, see `docs/agent-interface.md`. Start with `pnpm -s jank analyze <file>`, not the raw recording, and use `pnpm -s jank experiment` to test whether a change helps.
