# jank.js

This is the independent public performance tool. Keep private demonstration scenes, artwork, audio, server configuration and history out of this repository. Keep zero runtime dependencies, host-owned frame loops and optional renderer adapters. The recording viewer and small automated test fixtures belong to the tool. Reference checkouts are read-only.

Use pnpm 11.24.0 and the pinned tooling. Run changed-file type-aware oxlint fixes and oxfmt, then pnpm check. Run pnpm test:package for exports/assets and focused Playwright cases for UI, lifecycle or recording changes. pnpm check:full is the release gate. Benchmark collection/refresh changes with pnpm bench and state measurement limits.

Keep commits focused and verified. Do not push, publish or deploy unless requested. Never invent repository or registry URLs. Use labelled controls, not raw JSON authoring fields.
