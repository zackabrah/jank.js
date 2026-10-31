# Explicit GPU diagnostics and PMREM workaround — 1 November 2026

Jank commit `2657061` adds the opt-in native diagnostic API, a labelled browser page and
an offline build target. It submits six tiny passes, retains raw endpoints and shares the
live collector's rejection policy. It never converts a rejected duration to zero. The page
owns a separate device; integrations can explicitly probe their own idle device before
attaching the timing adapter. Neither path validates an entire scene's GPU timings.

The offline HTML was exercised through `file://` in installed Chrome 156.0.8078.76 on
Apple M3 Max / macOS 26.5.2 (25F84). It made zero HTTP(S) requests and emitted no browser
or uncaptured GPU errors. The two reused clear passes retained the first draw's end;
the fresh clear returned a zero end. The screenshot was inspected for readable raw values,
unknown durations and labelled controls. The separate, dependency-free upstream HTML
reproduced that pattern in three consecutive runs; its [evidence](webgpu-clear-only-evidence-2026-11-01.json)
and [draft report](webgpu-clear-only-upstream-draft.md) are retained. Nothing was submitted.

## Rendering experiment

[PMREM comparison data](pmrem-clear-merge-2026-11-01.json) retains each capture's pass count,
rejections, pixel comparison and all 120 CPU submission measurements. After six paired
warmups, 12 original captures each rejected one of 26 passes; the merged captures completed
all 25 passes. Across all 12 full atlases, differing components were zero. The scene changed
box rotation/colour and alternated null/colour backgrounds. Sixty timed pairs alternated
execution order, waiting for submitted work outside the CPU timer. Both medians were about
0.4 ms; no speedup claim is supported by that precision and noise.

Red Skies commit `1b47b09` scopes the workaround to its Three r186 reflection capture. It
merges the clear into the existing PMREM background draw and restores borrowed methods and
flags. Its production-helper pixel regression passed all 12 atlas comparisons. The initial
capture remains empty, and the reflection texture remains stable. Existing editor reflection
controls and diagnostics are sufficient; no new authored setting was needed.

## Checks and limits

- Jank: `pnpm check`, `pnpm test:package`, `pnpm test:coverage` and `pnpm bench` passed.
  340 CPU tests; coverage 98.38% statements, 96.08% branches, 99.15% functions, 98.37% lines.
- Headed Chromium: diagnostic page and independent raw PMREM readback tests passed.
- Page/download/accessibility checks ran in Chromium, Firefox and WebKit. Headless Chromium
  and Firefox lacked timestamp-query and explicitly skipped GPU assertions; WebKit completed
  all six probes. The installed-Chrome offline run reproduced the failure separately.
- The native upstream reproducer passed its focused headed Chromium test from `file://`.
- Red Skies: 532 CPU tests, coverage, lint, boundaries, TypeScript and production build passed;
  its new hardware pixel-parity case passed. The full check remains blocked by a pre-existing
  unrelated HTML formatting issue. The older reflection-cache test also fails with the original
  renderer (expects four captures after turbidity, observes three); expectations were not weakened.

A full live storm-transition reprofile is still needed before claiming the application now
has reliable whole-frame GPU metrics. This work isolates and avoids one reproduced failure;
it does not establish that all historical invalid samples shared that cause, or that accepted
positive intervals are independently calibrated. Package preview version remains rewrite.5;
the new diagnostic artifact carries its source revision. No new installable release or remote
publication was performed.
