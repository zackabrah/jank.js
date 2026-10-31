# Bounded slowdown episodes — 2026-10-31

Verification: 322 unit tests, package checks, 380 browser tests (seven existing GPU capability
skips), 96 visual checks, and per-file coverage gates passed. Browser coverage includes episode
configuration, repeated triggers, recovery, trigger navigation, full export and accessibility.
Unit regressions cover duration/frame caps, gaps, disarm, retry boundaries and schema validation.

An offline replay used the original 12,618 CPU frame intervals from the six supplied cloud-ramp
chunks. This is a controller check, not a new performance measurement. The threshold was 25 ms,
with 2 s before, 4 s minimum after, 2 s quiet recovery, a 30 s duration cap and 5 s cooldown.
The sustained slowdown grouped 811 threshold crossings into one duration-capped episode; after
cooldown, another episode grouped 707 crossings and reached quiet recovery. Two earlier isolated
crossings recovered separately. All four outputs passed serialization validation. Every output
was marked truncated because the source chunks have gaps; the duration-capped episode also
exhausted its duration allowance. Cooldown intentionally leaves intervals outside capture.
GPU observations and counters were not replayed. The controller finished armed.

The local Node microbenchmark on an Apple M3 Max measured 11.460 µs/frame median added cost for
8 scopes with sustained episode collection and validated serialization, amortized over 5,000
synthetic frames (batch means 11.320–12.608 µs/frame). This includes copying and GC noise and
excludes browser rendering, GPU, adapters and UI. It does not establish export latency, tail
latency or overhead in Red Skies. Raw benchmark output is retained alongside this report.
