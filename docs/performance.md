# Monitor overhead

Measured on **4 November 2026** at `9f6052e` with the 1.0 panel, Apple M3 Max, macOS arm64, headless Chromium 156.0.8078.4, on a cross-origin isolated fixture. These are measurements of the built library on one local fixture, not a guarantee for other applications or hardware. Raw report: [overhead.json](verification/overhead.json). Run `pnpm bench` to reproduce it.

| State                              | Mean monitoring + timer cost per frame | Largest observed cost | 0.3 panel mean |
| ---------------------------------- | -------------------------------------: | --------------------: | -------------: |
| Baseline without monitor           |                              0.0006 ms |              0.010 ms |      0.0015 ms |
| Line view                          |                              0.0920 ms |              4.000 ms |      0.0600 ms |
| Mini view                          |                              0.1149 ms |              3.925 ms |             new |
| Full panel, Live tab               |                              0.1172 ms |              3.230 ms |      0.1294 ms |
| Recording, full panel              |                              0.0828 ms |              2.185 ms |      0.1285 ms |
| Automatic capture armed, line view |                              0.2077 ms |              2.220 ms |      0.0708 ms |

The 0.3 column comes from [its own report](verification/overhead-0.3.json), measured on 27 October 2026 with the same method on Chromium 153.

The full panel costs about what 0.3's expanded panel did. Most frames pay only for collection. A refresh, four times a second, costs about 0.7 to 0.8 ms at the 95th percentile, close to 0.3's 0.5 to 0.75 ms, and peaked at about 2 to 4 ms in this run. The means spread that over 15 frames at 60 Hz.

The three views cost about the same, because the hidden parts of the panel keep rendering, so line view costs about 1.5 times what 0.3's collapsed state did. Results vary between runs and machine load: Mini ran 0.210, 0.068 and 0.067 ms here, and a quieter run of an earlier commit measured 0.066 ms for the full panel. Treat these as rough sizes, and don't read an order into the views.

Armed capture is the most expensive state, at about 1.2% of a 16.7 ms budget and about three times 0.3's figure, because the rule reads a collector snapshot every frame instead of at each refresh.

The panel also measures itself. Its **Overhead** footer reports the average and peak per frame, and its **ⓘ** button separates collection from UI work.

Earlier tray, measured on 26 October 2026 with the same method ([raw report](verification/overhead-v1.json)):

| State                          | Mean monitoring + timer cost per frame | Largest observed cost |
| ------------------------------ | -------------------------------------: | --------------------: |
| Baseline without monitor       |                              0.0013 ms |              0.010 ms |
| Collapsed                      |                              0.0576 ms |              0.705 ms |
| Expanded                       |                              0.0988 ms |              1.025 ms |
| Recording, expanded            |                              0.0961 ms |              1.100 ms |
| Spike capture armed, collapsed |                              0.0749 ms |              0.690 ms |

Each state ran three times, sequentially. Each run seeded 600 history entries, warmed up for 30 animation frames, then measured 120 explicit `beginFrame`/`endFrame` intervals. The fixture used a 1200 × 800 viewport, one Canvas 2D channel, a system font and no GPU provider. Detailed scope history gradually replaces the seed entries; this is not a worst-case densely instrumented capture.

The timing includes channel scopes, frame collection and synchronous panel refresh plus timer/loop overhead. It excludes scene drawing, deferred browser style/layout/paint, GPU execution, font loading and JSON download/import cost. The panel refreshes at most four times per second, so refresh frames cost more than the per-frame mean. Values are not baseline-subtracted. Do not infer significant differences between modes from this short run alone; their ordering is not a universal result.

The panel reports collection and exclusive refresh mean/peak over recent frames. Collection performed during a refresh is charged once. These internal measurements and the external benchmark have different boundaries, so they need not match exactly. Timer granularity can produce zero on individual measurements; recording metadata preserves the observed resolution estimate.

The first v1 measurement identified live snapshot copying as a cost worth reducing. Explicit copies of the bounded frame schema lowered the collapsed mean from about 0.155 ms to 0.0385 ms in the immediate comparison while retaining detached snapshots. The new API and extra scope capture still do more work than the earlier extraction benchmark; the original [pre-v1 report](verification/overhead-pre-v1.json) is retained separately.


The library ships minified ESM with internal identifier mangling and source maps for downstream bundling and debugging. Packaged panel CSS is minified. The panel and offline viewer use system monospace fonts; no font files are bundled. The core has zero runtime dependencies; application and renderer bundle sizes are outside these measurements.

## A/B comparison on real hardware

Chrome on an Apple M3 Max with Metal at about 144 Hz, one run each: two pairs, 0.5 s warm-up, 2 s measure, Baseline against each preset in [the playground](three-playground.md#ab-comparison). B − A median in ms, with the paired range in brackets:

| Backend | B          | CPU                     | GPU                  | Frame                |
| ------- | ---------- | ----------------------- | -------------------- | -------------------- |
| WebGL2  | CPU stress | +13.95 [+13.90, +14.00] | −0.05 [−0.07, −0.03] | +7.50 [+7.50, +7.50] |
| WebGL2  | GPU stress | +0.10 [+0.10, +0.10]    | +3.16 [+3.01, +3.32] | −0.00 [−0.00, +0.00] |
| WebGPU  | CPU stress | +14.00 [+14.00, +14.00] | +0.03 [0.00, +0.07]  | +7.70 [+7.70, +7.70] |
| WebGPU  | GPU stress | +0.25 [+0.20, +0.30]    | +2.13 [+1.97, +2.29] | 0.00 [0.00, 0.00]    |

CPU stress adds its 14 ms of work, and GPU stress adds GPU time without moving a frame that has headroom at this refresh rate. Verdicts need only a range that excludes zero, so very small shifts still earn a label: read the size beside it.

The runner costs nothing measurable when idle (0.015 µs per call) and about 0.15 ms per frame while running, 0.9% of a 16.7 ms budget, from recorded collection time with a 0.1 ms clock. It applies to A and B alike, so B − A is unaffected, but absolute frame times read slightly above an uninstrumented run. GPU-heavy runs exported up to 180 KB per measured second at 144 Hz, so the longest plans can pass the 32 MiB file limit; the run then ends as Failed and earlier trials stay exportable.

## WebGPU queue-counting overhead

Measured on 5 November 2026 on the Apple M3 Max with installed Chrome 156.0.8078.80,
using a cross-origin isolated page and a physical WebGPU device. Three off/on/on/off
blocks per method compare the original queue method with the counting wrapper;
GPU timestamp collection is disabled in both conditions. Each trial warms eight
batches, then measures 24 batches of 4,096 calls. Counter totals and GPU buffer
readback are checked. [Raw results and source hashes](verification/queue-counting.json).

| Counted method | Paired added CPU time per call | Same-setting spread per call |
| --- | --- | --- |
| `queue.writeBuffer` | +0.012 to +0.016 µs | 0.001 to 0.004 µs |
| `queue.submit` | −0.209 to +0.386 µs | 0.054 to 0.642 µs |

The upload-counting difference exceeded the observed same-setting spread in all
three blocks. Submission differences did not. These are synthetic 64-byte writes
and empty submissions, not full-frame overhead, GPU execution time, or a guarantee
for other hosts. Resource creation wrappers were not isolated. The earlier
non-isolated, shorter batches could not resolve upload timings and are excluded.

Reproduce on an idle desktop with `pnpm test:e2e:gpu e2e/three-device-overhead.spec.ts`.
The normal headless suite skips this hardware-only measurement.
