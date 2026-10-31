# Local rewrite acceptance · 31 October 2026

This review covers the implemented rewrite in this worktree, including loading and optional
renderer diagnostics. The original checkout remains a read-only reference. Packages remain
private; this is local acceptance evidence, not a publication or production rollout.

## Retained features and visual review

The [core reference audit](ui-parity.md) covers live graphs, panel modes and the offline viewer.
Loading now covers overlapping stages, retained cold baselines, cache/byte observations and
session history. [Optional renderer diagnostics](../renderer-diagnostics.md) restore Three
counters, visibility/instance readouts, temporal controls and bounded world-AABB overlays.
The gallery and original/rewrite harness include interactive synthetic diagnostics. The basic
demo exercises actual cube culling and CPU-projected motion/history; it has no instanced meshes
and does not implement GPU velocity buffers or temporal antialiasing.

The side-by-side review retains the neutral monospace theme, panel widths, readouts and controls.
Disclosure layout, typography weight, clearer unavailable states and explanatory notes differ;
this is not pixel-identical acceptance. The original preview's instance view identifier is
normalized to its lowercase convention: both sides now show 700/1000 visible, two frames old,
instead of the original preview incorrectly waiting for a sample. The original source was not edited.

## Verification

- `pnpm check`: lint, formatting, strict types, contracts, tooling policy and 309 unit tests pass.
- `pnpm test:coverage`: 98.28% statements/lines, 95.97% branches, 99.09% functions;
  all per-file floors pass.
- `pnpm test:package`: independent builds, exported entry points and isolated runtime/type
  consumers pass. Renderer counters remain an optional export without a Three runtime import.
- Full browser suite: 347 passed, seven skipped across Chromium, Firefox and WebKit.
  Skips cover unavailable or opt-in WebGPU readback/overhead/finalization cases; this run does
  not establish every hardware timestamp path. Existing adapter evidence remains in
  [GPU documentation](../gpu-adapters.md).
- Visual suite: 71 passed initially; one WebKit MINI screenshot differed by eight pixels at
  the expand icon. That unchanged case passed three repeated reruns, without updating a
  baseline or relaxing thresholds. This transient mismatch remains recorded here.
- New diagnostics have desktop/narrow visual and axe checks, source-error/freeze/ordering
  regressions, bounded canvas lifecycle checks and real demo culling/temporal cases.
- Knip passes with actual HTML-fed entry points and public adapter exports configured.
  Pinned development-only commit/comparison tools are documented exclusions; runtime
  dependencies and unresolved imports are not broadly suppressed.

## Measured overhead

Local Apple M3 Max, macOS Darwin 25.5.0, Node 24.22.1; panel measurements use headless
Chromium 153.0.8010.12. These measurements compare instrumented and uninstrumented host loops,
not the original implementation. They are not evidence of a speedup or real application headroom.

The [collection report](acceptance-collection.json) uses 15 batches of 5,000 frames.
Median incremental collection is 0.180 microseconds/frame for frame boundaries, 1.306 for eight
scopes, 20.465 for 128 scopes, and 13.160 for eight scopes plus a snapshot every six frames.
Manual capture with eight scopes adds 1.851 microseconds/frame; capture plus serialization
adds 12.087, amortized across the batch. Construction, disposal, UI, adapters and GPU are excluded.

The [panel report](acceptance-panel.json) uses 15 alternating paired batches per mode,
5,000 frames after 600 warm-up frames, with the same eight scopes and counter collection in
both paths. Median incremental synchronous milliseconds **per host frame**:

| Mode                  | Median ms | Batch range ms |
| --------------------- | --------: | -------------: |
| LINE                  |    0.0092 |  0.0086–0.0098 |
| MINI                  |    0.1212 |  0.0583–0.2434 |
| FULL                  |    0.1686 |  0.1381–0.2033 |
| FULL with diagnostics |    0.2536 |  0.2142–0.2862 |

This includes normal refresh throttling, source reads, copies and DOM/canvas commands, plus
any forced layout. It excludes deferred paint/GPU work, real scheduling, renderer diagnostics
computation and bounds drawing. Batch ranges are not frame-tail latency. Static synthetic
sources do not estimate the cost of a production visibility or temporal pipeline.

## Package boundaries and size

Both packages remain private and have no runtime dependencies. Junkui does not import Jank
or Three. Optional renderer timing/counter entry points remain separate. The built distribution
sizes below sum files by type; gzip totals compress each file independently and are not an
application's tree-shaken download size. Declarations and source maps are excluded.

| Package                        | JavaScript bytes | JS gzip bytes | CSS bytes | CSS gzip bytes |
| ------------------------------ | ---------------: | ------------: | --------: | -------------: |
| jank.js (all eight JS outputs) |          333,914 |        86,952 |    35,953 |          6,617 |
| junkui (two JS outputs)        |            5,324 |         1,582 |     5,360 |          1,664 |

The standalone library and viewer are rebuilt as single HTML files for offline review.
No private scene assets or renderer runtime dependencies were added to shipped packages.

## Remaining decisions and integration work

Production Red Skies pass labels and adoption of comparison/finalized-export workflows require
changes at the actual host submission sites. Production visibility and temporal data remain
host-owned. Hardware-specific GPU evidence, remaining visual differences and real application
profiler overhead should be reviewed before a release decision. No branch promotion, push or
publication is included in this work.
