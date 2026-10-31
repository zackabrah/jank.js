# Optional GPU timing

The package exports `createWebGl2GpuSource` from `jank.js/adapters/webgl2` and
`createThreeWebGpuSource` from `jank.js/adapters/three-webgpu`. Neither imports a renderer or
starts a loop. The root profiler entry does not import either adapter. See the
[package integration examples](../packages/jank/README.md#optional-gpu-timers).

The host owns the renderer and adapter. Supply `onSample: profiler.observeGpu` to retain every
completed result, including out-of-order completions. Also call `profiler.observeGpu(gpu.read())`
each host frame to update status and age. Use `null` for an unknown profiler frame association.
Replace the adapter when replacing the profiler; IDs from the same profiler never repeat.
An open panel is not required for recording.

## WebGL2 ownership and limits

The adapter uses [EXT_disjoint_timer_query_webgl2](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).
Wrap each sequential pass in `beginPass(label)` / `endPass()`, then call `captureFrame` once
for that host frame. Never nest elapsed-time queries or overlap them with another profiler's
queries. A foreign active query produces an error without ending or deleting the host query.
The adapter deletes only queries it allocated.

Results are polled using availability checks; no busy-wait or synchronous GPU finish is used.
Nanoseconds become milliseconds. A disjoint event invalidates all outstanding samples,
including queries whose results are not ready. Context loss releases adapter bookkeeping and
reports an error; subsequent host calls reacquire the extension after restoration. Disabling
or disposing frees active and pending queries. Late calls after disposal are harmless.

At most 32 passes are measured per frame and 64 frames await readback. Excess passes increment
`omittedPasses` and make the total `null`, while retaining the measured pass values. Overflow
evicts the oldest pending frame, deletes its queries and increments `droppedSamples`. Invalid
results become an error; finite zero is a valid measurement.

## Three r186 WebGPU

Verified against **Three.js 0.186.1**. Await `renderer.init()` and initialize compute nodes and
render pipelines before the normal frame loop. Pass `revision: THREE.REVISION`; other revisions
are rejected. A WebGL fallback or absent `timestamp-query` feature reports unsupported timing.
Three is a host dependency; Jank does not import or bundle it.

```js
import { createThreeWebGpuSource } from "jank.js/adapters/three-webgpu";
import { REVISION } from "three";

await renderer.init();
const gpu = createThreeWebGpuSource(renderer, {
  revision: REVISION,
  enabled: true, // default is false
  onSample: profiler.observeGpu,
});

function onFrame(timestampMs) {
  const frameId = profiler.beginFrame(timestampMs);
  gpu.beginFrame(frameId > 0 ? frameId : null);
  try {
    gpu.withPass({ id: "ocean-fft", label: "Ocean FFT", category: "water" }, () => {
      renderer.compute(oceanFft);
      renderer.compute(oceanFft); // both invocations are retained
    });
    gpu.withPass({ id: "scene", label: "Main Scene", category: "graphics" }, () => {
      renderer.render(scene, camera);
    });
  } finally {
    gpu.endFrame(); // queues asynchronous readback; never await in this callback
  }
  profiler.observeGpu(gpu.read());
  panel.refresh(timestampMs);
}
```

`beginFrame` must precede **all** compute/render encoding and `endFrame` must follow the final
submission. Multiple renderer calls and repeated native passes belong to that single application
frame. Work outside the bracket is excluded. Deferred command buffers and async submission
callbacks are unsupported; do not carry encoded passes across the bracket. `withPass` rejects
thenables and marks the frame incomplete, but cannot cancel host asynchronous work.

`captureFrame(id)` remains an alias for closing a matching **already-open** bracket; the old
end-only rewrite.2 integration must change. Application IDs must increase independently of
simulation time. `beginFrame(null)` collects explicitly unassociated work. A separate adapter
sequence measures sample age even if Three's counter repeats or the simulation pauses.

A label applies to every native pass in its synchronous callback, including nested renderer
utility passes. Nested labels restore the outer label. Each invocation gets an ordered number;
identical IDs never overwrite one another. IDs, labels and optional categories accept 1–240
characters. Supply stable IDs yourself: automatic Three context labels are only session-local
fallbacks. No scene traversal or additional animation loop is installed.

### Ownership and lifecycle

The adapter exclusively owns **both** timestamp paths for the renderer and its GPU device while
attached. Do not attach a second profiler, change `backend.trackTimestamp`, replace its timestamp
methods/device encoder factory, or call Three's `resolveTimestampsAsync` while attached. Finish
any existing Three resolver before attaching. Ownership changes become explicit errors.

It intercepts native `beginRenderPass` / `beginComputePass` on encoders created by that device,
rather than trusting one Three initializer to equal one native pass. Layered rendering can
reuse a descriptor; renderer utility passes can bypass Three's initializer. Every native pass
gets its own query pair. Existing foreign `timestampWrites` are preserved and make the frame
incomplete. Device work encoded by another renderer inside the bracket is included too.

Jank allocates and resolves its own query sets and buffers; existing Three pools are untouched.
It temporarily replaces the backend initializer/resolver and the device's encoder factory,
without patching global prototypes. Disposal restores original property descriptors and prior
tracking state when the host has not replaced them. Only Jank resources are destroyed. Device
loss cancels pending reads and requires a new renderer/adapter. Disabled/disposed generations
cannot deliver late samples to the old profiler; the device-loss subscription releases its
callback on disposal. `setEnabled(false)` destroys pending resources; re-enabling starts fresh.

### Metrics, precision and limits

Each sample carries a decimal uint64 GPU origin and integer nanosecond offsets. The adapter
subtracts BigInt origins **before** converting offsets to numbers. This is a GPU clock, unrelated
to `performance.now()`. Timestamp resolution/quantization is browser and device dependent.
A nonzero equal start/end is a valid zero duration; an all-zero unwritten pair is unavailable.

- Render sum: sum of render pass durations.
- Compute sum: sum of compute pass durations.
- Combined sum: render plus compute sums, potentially double-counting overlap.
- GPU busy: union of all observed compute/render intervals, counting overlap once.
- GPU elapsed span: earliest start through latest end, including gaps.

These cover the bracket's observed passes, not global device utilization, presentation latency,
or CPU work. Never add CPU and GPU timings into a frame total. Complete empty brackets have
known zero metrics; partial brackets retain valid intervals but expose `metrics: null`.

Default limits are 256 passes/frame, four simultaneous slots, a 2,000ms readback timeout and
128 retained resolved samples. Options allow 1–256 passes, 1–8 slots and 1–10,000ms timeout.
The default maximum is four query sets, eight buffers and 32,768 buffer bytes (driver query-set
storage excluded). Slots are lazy and reused only after mapping ends. `diagnostics()` exposes
live slot, buffer-byte, pending-frame and retained-sample counts.

Excess passes are counted as omissions (`query-capacity`); full slots produce an incomplete
`queue-pressure` frame without waiting. Invalid/missing timestamps, read failures/timeouts,
submission failures, unclosed frames, ownership changes and lifecycle cancellation have named
reasons. A frame's representable timestamp span is at most 60 seconds. Incomplete published
frames increment dropped-sample counts, except deliberately sampled-out frames. The latest display never moves back when an older
frame resolves, while `onSample` still forwards every result. Retention eviction affects later
finalization, not results already delivered to recording history.

`resolveFrames(ids, { timeoutMs })` waits only for requested pending frames outside the host loop,
returns detached retained samples and explicit pending IDs, and accepts at most 6,000 IDs and
0–10,000ms. Only one drain may be pending. Close requested brackets first. A settled drain may
still lack evicted/unobserved frames; it does not claim capture completeness.

Schema 5 stores intervals, associations, metrics, omissions and rejected timestamp diagnostics
with strict validation. Versions 1–4 are rejected, not converted. See [recording semantics](recordings.md) and the [verification
report](verification/webgpu.md) for actual browser evidence and measurement limits.

## Rejected timestamp diagnostics (schema 5)

Non-episode source captures write schema 5; time-based episodes write schema 6; the archived rewrite.3 preview remains schema 4.
Rejected native passes retain their ID, label, category, invocation, renderer frame ID and
absolute timestamp pair in `rejectedPasses`. Values are decimal uint64 strings; null means
the readback value was absent. Accepted and rejected passes share the existing per-frame and
recording storage budgets. Rejected measurements never become measured zero or complete totals.

- `missing-timestamp`: one or both readback values are absent.
- `zero-timestamp`: an endpoint is zero; Jank conservatively treats this as unavailable.
- `reversed-timestamp`: both endpoints are nonzero and the end precedes the start.
- `out-of-range-timestamp`: a pair duration or its frame-relative end exceeds Jank's 60s bound.

Classification follows that order. Equal nonzero endpoints are a valid quantized zero duration.
These reasons describe observations and Jank's acceptance policy, not their underlying cause.
The [WebGPU timestamp specification](https://www.w3.org/TR/webgpu/#timestamp-query) requires
applications to handle arbitrary values and notes that counter resets can produce negative deltas.
Controlled tests verify each rejection, exact large values, ordered diagnostic identities,
copying, codec limits and round trips. No hardware fault injection is claimed.

## Coverage, capacity and explicit sampling

`profiler.capture.getProgress()` describes the active manual/automatic capture, or recent history
when idle. It returns sealed-frame count, remaining frame capacity and GPU interval coverage.
`summarizeGpuCoverage(recording)` provides the same coverage calculation for a saved file;
`finalizeRecording` also returns `coverage`. No GPU durations are fabricated.

Coverage counts each CPU frame once: complete interval evidence, incomplete evidence, deliberate
sampling, or no interval evidence. All brackets associated with a frame must be complete before
that frame counts as complete. Missing data has no inferred cause; it may be pending, disabled,
unsupported or evicted. Reason counts may overlap when a frame has multiple issues. Legacy
WebGL duration samples are not counted as complete WebGPU interval evidence.

The panel shows active coverage above the tabs' content, detailed coverage and capacity in CAPTURE,
and coverage/reasons on saved cards. Freeze does not freeze capture progress.
`profiler.snapshot().gpuCapacity` reports remaining space in the shared retention pool, including
measurements outside the capture: 6,000 sample records and 16,384 accepted/rejected pass records.
When pass details are evicted, an incomplete `retention-capacity` marker preserves the associated
frame and omission count until the sample limit itself evicts that marker. These markers are
retained in exported recordings. Finalization cannot recover details already evicted everywhere.

For longer captures with dense GPU work, set `sampleEveryNFrames` on `createThreeWebGpuSource`:
1 (default) captures every bracket, 2 every other bracket; the allowed range is 1–6,000. Sampling
starts with the first enabled bracket. Skipped brackets allocate no timestamp slot and retain a
`sampled-out` marker. They do not increment dropped-sample counts or become measured zero. They
reduce overall coverage, and may miss intermittent hitches or alias periodic workloads. CPU
collection and the 6,000-frame/32 MiB recording limits remain in force; this is explicit sampling,
not streaming.

A [clear-only timestamp investigation](verification/timestamp-clear-2026-11-01.md) reproduces
stale end values with native WebGPU and confirms exact adapter readback for PMREM. This remains
a measurement limitation; rejected passes and null totals are preserved.
