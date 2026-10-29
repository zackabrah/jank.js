# Readability rewrite

This worktree starts from development tooling, new contracts and a new collector. The original checkout is a
read-only behavioral and visual reference. Do not copy its implementation wholesale.

Keep `jank.js` as the profiler package name. `junkui` is an independent UI and theme package.
Both are private while the rewrite is incomplete. Do not publish or push without instruction.

Read `docs/architecture.md` before implementation and `docs/quality.md` before changing rules.
The public API and recording format may change. Preserve the existing user-facing features,
appearance, accessibility, host-owned frame loop, and truthful measurement semantics.

Use pnpm 11.24.0 and the exact pinned development dependencies. Keep shipped packages free of
runtime dependencies. Renderer adapters remain optional. Keep private scenes and assets out.

Name concepts and units explicitly. Prefer direct control flow, cohesive modules, and one
owner per mutable value. Extract shared code only when callers share a real invariant.
Do not create forwarding layers, generic service containers, event buses, or a `utils` bucket.

Biome's recommended rules plus the documented additions are the automated baseline. Do not
enable every rule or weaken a rule merely to get a green check. Any local suppression must
explain a concrete invariant and be reviewed. A short file alone is not a design improvement.

Use test-driven development for implementation: write a behavioral test, observe its failure,
implement the behavior, then refactor with the tests passing. Add regressions before fixes.
Run changed-file Biome fixes, then `pnpm check` and `pnpm test:package`. For collection/lifecycle
changes also run `pnpm test:coverage`, focused `pnpm test:browser` cases and `pnpm bench`.
Report measurement limits. UI accessibility/visual and release gates arrive with their real
implementation slices. Do not add empty tests, placeholder implementations, or no-op gates.

Commit each completed, verified slice before starting another. Preserve unrelated work.
Use labelled controls; JSON is an interchange format, never an authoring interface.
