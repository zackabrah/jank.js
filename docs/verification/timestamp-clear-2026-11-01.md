# Reflection timestamp investigation — 1 November 2026

The reversed reflection pair is reproducible without Jank or Three. On the local Apple M3 Max,
macOS 26 / Chrome 156, a native WebGPU draw followed by two clear-only render passes using the
same query pair returned fresh starts but the original draw's end for both clears. Returning
to a drawn pass refreshed both endpoints. No WebGPU validation errors were reported.
The attached JSON preserves the four raw pairs and the PMREM comparison.

This isolates this reproduced failure below the adapter, in the browser/device timestamp path;
it does not distinguish Dawn from Metal/driver behavior or establish that every historical
invalid interval has the same cause. No runtime workaround or GPU ranking is claimed.

A Three 0.186.1 PMREM `fromScene` reproducer alternates a normal render and a 128-pixel
reflection capture. All six PMREM captures retained 26 native passes and rejected the first
clear-only pass. A separate query resolve and separate readback buffers exactly matched both
endpoints of every accepted and rejected Jank interval over all 12 brackets. A fresh empty slot
instead yielded a zero endpoint in an earlier probe. Reusing a populated slot explains how an
unwritten end can become a reversed pair. Each slot was fully unmapped before reuse.

The Red Skies reprofile has 372 reversed reflection pairs, all at invocation 2 or 3, with
repeated old end values. Its integration brackets synchronous environment and scene submissions.
The isolated clear reproduction matches that failure pattern; it does not validate all accepted
intervals or establish whole-frame GPU accuracy. Large overlapping pass sums are not themselves
proof of a pairing error, and must not be substituted for elapsed time.

The portable fixture at `tests/fixtures/gpu/timestamp-diagnostic.html` includes the native
control and PMREM comparison. Run `pnpm exec playwright test
 tests/browser/gpu-timestamp-diagnostic.spec.ts --project chromium --headed` (one line).
It checks exact raw evidence preservation, including rejected pairs, and attaches the report.
Unsupported hardware is explicitly skipped; the test does not require every platform to exhibit
the failure. The focused Chromium check passed locally. Standard checks and package tests passed.

Do not inject dummy draws, replace rejected intervals with zero, or drop clears and label the
remaining work complete. A browser/device fix or independently validated timing path is needed
before ranking the reported GPU workload. The [WebGPU specification](https://www.w3.org/TR/webgpu/#timestamp-query)
requires handling arbitrary timestamp values; diagnostics identify observations, not fault ownership.

Follow-up: the [explicit diagnostic and PMREM merge experiment](gpu-diagnostic-2026-11-01.md)
now provide a tested application workaround for this reproduced clear-only failure, plus a
[dependency-free upstream reproducer and draft](webgpu-clear-only-upstream-draft.md).
The broader measurement limits above still apply.
