# First measurement slice

The internal collector is implemented. It owns host frame boundaries, CPU scopes, 600 sealed
frames, channel identity and synchronous overhead. It imports no DOM, Node, renderer, capture
or presentation code. Public `createProfiler` now composes this owner with capture and optional
observations; see [the subsequent capture slice](recordings.md).

## Timing and ownership decisions

- `beginFrame` seals the previous interval. `endFrame` adds optional CPU totals; it does not
  seal a frame. Missing totals stay `null`. Repeated boundaries accumulate work in one frame.
- Times are relative to construction. An initial callback boundary predating construction is
  skipped. Clear preserves the origin and increasing frame/token IDs; stale handles cannot
  attach work to a replacement frame.
- Frame timestamps and scope-clock readings each advance monotonically. Do not order one
  sequence against the other: Firefox exposed independently rounded values in the real fixture.
  Scope intervals are clipped to frame boundaries, with completed tails retained for late
  callbacks. Open scopes are measured through each observed boundary. All timings remain
  limited by browser clock precision; this is not instruction-level CPU measurement.
- Every scope request has its own idempotent release. Demand changes affect the next distinct
  frame, so its coverage describes the whole collection interval.
- Open and completed pending scopes share a bounded budget: 128 by default, configurable from
  1 to 1,024. Rejected scope starts and cancelled open scopes are reported as omitted work.
  A scope token belongs to its collector and channel; it is not a transferable timestamp.
- Up to 64 channel identities and 240 characters per ID/label are retained. Disposed identities
  keep their historical labels. A disposed ID can be reused with that label; clear frees
  disposed identities. Disposing a channel invalidates open work and retains finished work.
- Snapshots copy nested values at the ownership boundary. Reading does not consume history.
  Overhead summaries describe the current sealed history. Collection cost is attributed to
  the active frame; the work of sealing a frame is charged to the newly opened frame.
- Refresh measurement subtracts nested collection cost, counts nested refresh once and
  preserves callback results/errors. Clear/dispose during refresh cannot charge a new frame.
- The host owns scheduling. Disposing the collector releases its stored data and makes late
  measurement calls harmless; it does not cancel the host loop or execute scheduled work.

The timing decision is consistent with the distinct callback timestamp described by
[MDN's animation-frame documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
and the [Firefox timer-coarsening issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1838890).

## Test-driven verification

Tests preceded the collector implementation. Subsequent red/green cycles covered channel
identity and label limits, stale clocks, Firefox's rounded scope clock, and pre-creation frame
boundaries. Refactoring keeps clock validation in the collector, interval retention in the
scope recorder, and ring-buffer storage/copying in frame history.

The collector suite contains 28 unit/property tests alongside contract and tooling checks. Two
seeded properties cover 100 cases each: contiguous bounded history and conservation of scope
duration across late boundaries. Focused tests cover clipping, nesting, capacity, CPU overflow,
snapshot isolation, independent demand, disposal, clearing and overhead on thrown callbacks.

`pnpm test:browser` runs the same real host-loop scenario in Chromium, Firefox and WebKit.
It verifies scope collection, clear/ID continuity and that the host keeps running after
collector disposal. `pnpm test:package` builds both packages' declarations and compiles an
isolated consumer without workspace sources. Runtime package exports and the full UI remain
outside this slice.

## Measurement

The checked-in [measurement report](verification/collection.json) records this internal
collector slice's historical run and machine. `pnpm bench` now exercises the public profiler
and writes `artifacts/collection-benchmark.json`; see the [current capture report](verification/capture.json).
Each workload warms both paths three times, then runs 15 paired samples of 5,000 host frames,
alternating baseline/instrumented order. The baseline performs the same host bookkeeping
without the collector. Costs use a real high-resolution clock; frame time is synthetic.

Results are local Node batch averages, including synchronous copying and garbage-collection
noise. They exclude browser layout/paint/GPU, capture, adapters and the final UI. Min/max are
batch means, not per-frame tail latency. They are neither a browser performance guarantee nor
a comparison against the old implementation.
