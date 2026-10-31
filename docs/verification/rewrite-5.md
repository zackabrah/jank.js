# rewrite.5 release checks — 1 November 2026

Changes: selectable sustained-budget triggering with onset/confirmation metadata (schema 7),
bounded slowdown episodes, improved GPU evidence display and pinned/rounded counters, plus
source build identification in recordings, the panel and the offline viewer. Non-sustained
files retain schemas 5/6; the updated parser reads 5/6/7. The package remains private.

Verified before packaging: 328 unit tests; lint, types, contracts and tooling; package consumers
including sustained capture and source identity; per-file coverage thresholds; 387 browser
interaction tests with nine explicit GPU capability/opt-in skips; and 102 visual checks across
Chromium, Firefox and WebKit. Visual baselines changed for the version footer. Offline checks
include local import with network disabled, build identification and narrow-screen layout.
Coverage: statements/lines 98.35%, branches 96.03%, functions 99.14%.

Sustained-trigger replay and microbenchmark limits are in sustained-budget.md. The native
clear-only timestamp reproduction and separate readback comparison are in
timestamp-clear-2026-11-01.md. Invalid GPU timing is not fixed or converted into zero; no GPU
ranking or production performance improvement is claimed by this release.

`pnpm build:bundle` builds only committed clean source, writes source identity/checksums and
includes both package archives, both standalone pages, docs, GPU diagnostic evidence and a
synthetic sustained episode. It does not publish or push. BUILD.json identifies the exact
release source; development imports use +source and ad hoc modified builds use -dirty.
