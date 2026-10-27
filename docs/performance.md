# Monitor overhead

Measured on **27 October 2026** with the jank.js panel, Apple M3 Max, macOS arm64, headless Chromium 153.0.8010.12, on a cross-origin isolated fixture. These are measurements of the built library on one local fixture, not a guarantee for other applications or hardware. Raw report: [overhead.json](verification/overhead.json).

| State                           | Mean monitoring + timer cost per frame | Largest observed cost |
| ------------------------------- | -------------------------------------: | --------------------: |
| Baseline without monitor        |                              0.0015 ms |              0.055 ms |
| Collapsed (one line)            |                              0.0600 ms |              1.305 ms |
| Expanded (full panel, LIVE tab) |                              0.1294 ms |              1.155 ms |
| Recording, expanded             |                              0.1285 ms |              0.960 ms |
| Spike capture armed, collapsed  |                              0.0708 ms |              0.695 ms |

The full panel redraws ten times a second where the earlier tray redrew four times, and it draws more (tiles, a canvas graph, per-frame CPU scope averages, counters). Expanded costs about 0.03 ms per frame more than the earlier tray's measurement below. One-line and armed states are within run-to-run variation of it; a repeat run on the same machine measured 0.049, 0.116, 0.107 and 0.058 ms for the four monitored states.

The panel also measures itself. Its OVERHEAD block reports refresh separately from collection. On the e2e fixture game (four timed systems, a scripted GPU source, a loading source), with a 0.1 ms timer and eight seconds per size after clearing: one line averaged 0.003 to 0.006 ms of refresh per frame with a 0.2 ms worst refresh; mini 0.02 ms with 0.3 to 0.4 ms worst; the full panel's LIVE tab 0.03 to 0.04 ms, 0.3 ms at the 95th percentile and 0.4 ms worst, with a single 2.1 ms refresh in one of two runs. Averages are within the panel's targets (0.1 ms full, 0.02 ms one line); the full panel's worst refresh is not reliably within 0.3 ms at this timer resolution. Completing an automatic capture serialises it once, which shows as a larger single refresh.

Earlier tray, measured on 26 October 2026 with the same method ([raw report](verification/overhead-v1.json)):

| State                          | Mean monitoring + timer cost per frame | Largest observed cost |
| ------------------------------ | -------------------------------------: | --------------------: |
| Baseline without monitor       |                              0.0013 ms |              0.010 ms |
| Collapsed                      |                              0.0576 ms |              0.705 ms |
| Expanded                       |                              0.0988 ms |              1.025 ms |
| Recording, expanded            |                              0.0961 ms |              1.100 ms |
| Spike capture armed, collapsed |                              0.0749 ms |              0.690 ms |

Each state ran three times, sequentially. Each run seeded 600 history entries, warmed up for 30 animation frames, then measured 120 explicit `beginFrame`/`endFrame` intervals. The fixture used a 1200 × 800 viewport, one Canvas 2D channel, a system font and no GPU provider. Detailed scope history gradually replaces the seed entries; this is not a worst-case densely instrumented capture.

The timing includes channel scopes, frame collection and synchronous tray refresh plus timer/loop overhead. It excludes scene drawing, deferred browser style/layout/paint, GPU execution, font loading and JSON download/import cost. The full and mini panels refresh at most ten times per second and the one-line panel four, so refresh frames cost more than the per-frame mean. Values are not baseline-subtracted. Do not infer significant differences between modes from this short run alone; the expanded and recording ordering is not a universal result.

The live panel reports collection and exclusive refresh mean/peak over recent frames. Collection performed during a refresh is charged once. These internal measurements and the external benchmark have different boundaries, so they need not match exactly. Timer granularity can produce zero on individual measurements; recording metadata preserves the observed resolution estimate.

The first v1 measurement identified live snapshot copying as a cost worth reducing. Explicit copies of the bounded frame schema lowered the collapsed mean from about 0.155 ms to 0.0385 ms in the immediate comparison while retaining detached snapshots. The table above is the final remeasurement, after browser-boundary fixes; run-to-run variation remains visible. The new API and extra scope capture still do more work than the earlier extraction benchmark; the original [pre-v1 report](verification/overhead-pre-v1.json) is retained separately.

Run `pnpm bench` to produce `artifacts/overhead.json`, or `pnpm bench docs/verification/overhead.json` to refresh the [current raw report](verification/overhead.json). Run on an otherwise idle machine and compare equivalent workloads. More systems, scopes, custom views, DevTools recording and real GPU providers can cost more.

The library ships minified ESM with internal identifier mangling and source maps for downstream bundling and debugging. Packaged panel CSS is minified. The panel and offline viewer use system monospace fonts; no font files are bundled. The core has zero runtime dependencies; application and renderer bundle sizes are outside these measurements.
