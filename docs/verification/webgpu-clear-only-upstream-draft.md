# Draft upstream report: clear-only render pass end timestamps stay stale on Apple Metal

Status: prepared for review; not submitted.

## Reproduction and environment

- Apple M3 Max; macOS 26.5.2, build 25F84.
- Installed Chrome 156.0.8078.76, headed through Playwright; no timestamp-related flags.
- WebGPU adapter reports vendor `apple`, architecture `metal-3`.
- Native WebGPU only: no Jank adapter, Three renderer, scene assets or framework imports.
- [Standalone reproducer](webgpu-clear-only-reproducer.html) and
  [three complete runs with raw endpoints](webgpu-clear-only-evidence-2026-11-01.json).

Open the HTML locally in Chrome and select **Run native probe**, then **Download evidence**.
If the browser does not expose WebGPU on local files, serve the file on localhost. It submits
six passes to a 16×16 `rgba8unorm` attachment. Each uses `loadOp: clear`, `storeOp: store`,
and both beginning/end timestamp indices. Drawn controls submit a full-screen triangle.
Clear-only passes call `end()` without a draw.

The first query set runs draw → clear → clear → draw. A separate, unused set runs
clear → draw. Each pass resolves exactly two queries into a 16-byte resolve buffer,
copies them into a separate readback buffer, awaits `mapAsync`, copies the uint64 values
as strings, and unmaps before reuse. Readback has a three-second timeout. The probe
releases its own device and resources; it performs no external requests.

## Observed

All three local runs reproduced the same pattern with no validation or browser errors:
the reused clear-only passes had new start values but retained the previous drawn pass's
end value. Their end therefore preceded their own start. The unused query pair's clear-only
end was zero. Following draws refreshed both values and returned ordered pairs.

First run, raw nanoseconds:

| Probe | Work       | Query set | Start           | End             |
| ----- | ---------- | --------- | --------------- | --------------- |
| 1     | draw       | reused    | 132100254269440 | 132100254597120 |
| 2     | clear only | reused    | 132100255776768 | 132100254597120 |
| 3     | clear only | reused    | 132100256956416 | 132100254597120 |
| 4     | draw       | reused    | 132100262854656 | 132100262920192 |
| 5     | clear only | fresh     | 132100265738240 | 0               |
| 6     | draw       | fresh     | 132100267245568 | 132100267442176 |

## Investigation request and limits

Please investigate whether the Metal path is failing to write the end sample for a pass
that only clears. A useful timing result would describe the current pass rather than retain
a previous pass's endpoint. This report does not claim a specification violation: the
[WebGPU timestamp specification](https://www.w3.org/TR/webgpu/#timestamp-query) permits
arbitrary results, including unexpected deltas. Consumers must continue rejecting invalid
pairs; equal nonzero timestamps can also occur through quantization.

The [current Dawn Metal command-buffer source](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/metal/CommandBufferMTL.mm)
uses `startOfVertexSampleIndex` and `endOfFragmentSampleIndex` for render-pass boundaries.
A pass with no fragment work not updating the latter is a hypothesis, not a confirmed cause.
The inspected source blob was `fbc1cd9d66975d3449f620f521360826aa1d71a0`; its correspondence
to the installed Chrome build has not been established. This evidence does not distinguish
Dawn behavior from Metal/driver behavior or validate all plausible positive intervals.

## Application impact and separately tested workaround

Three 0.186.1 PMREM generation begins with a standalone atlas clear. A separate experiment
captured all native query pairs twice using independent resolve/readback storage; both
readbacks agreed, including rejected endpoints. This rules out Jank's pair conversion or
readback mapping as the cause of that reproduced failure.

Merging the atlas clear into PMREM's existing background draw removed that draw-free pass:
12 original captures each rejected one of 26 passes; all 12 merged captures had 25 complete
passes. All atlas pixel components matched exactly. This is a narrowly tested application
workaround, not a browser fix, and no GPU speedup or whole-scene GPU ranking is claimed.
The native reproducer above remains unchanged and still reproduces the underlying behavior.
