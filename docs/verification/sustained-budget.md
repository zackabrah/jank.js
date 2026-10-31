# Sustained frame-budget triggering — 1 November 2026

328 unit tests, per-file coverage gates, 15 focused cross-browser automatic-capture interaction
checks and 102 visual checks passed. Package checks passed. Regressions cover isolated spikes,
continuous slowdown, budget changes, gaps, rearming, schema validation and onset truncation.

An offline replay used 12,618 original CPU frame intervals from the six cloud-ramp chunks.
At 60 FPS with a 250 ms sustained rule, 2 s prehistory, 4 s minimum tail, 2 s quiet recovery,
a 30 s episode limit and 5 s cooldown, it produced two episodes. The first confirmed at frame
8241 (41.7 ms), preserving onset 8236 and six qualifying frames; it reached the duration cap.
The second confirmed at 9205 (34.8 ms), preserving onset 9198 and eight qualifying frames; it
recovered. Both confirmation frames are below the old 50 ms spike threshold. Source gaps remain
explicit and both files were truncated. Every replay output passed serialization validation.
This checks trigger behavior against existing evidence, not new performance or GPU measurements.

The added local benchmark exercises sustained episodes at a 120 FPS budget with 16 ms synthetic
frames, eight scopes, copying and validated serialization. Median added cost was 11.590 µs/frame,
with batch means 11.111–12.835 µs/frame on Apple M3 Max / Node 24.22.1. It is amortized across
5,000 frames, excludes browser/GPU/UI work and does not establish tail or export latency.
