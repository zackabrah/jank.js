# Optional GPU timing

The package exports `createWebGl2GpuSource` from `jank.js/adapters/webgl2` and
`createThreeWebGpuSource` from `jank.js/adapters/three-webgpu`. Neither imports a renderer or
starts a loop. The root profiler entry does not import either adapter. See the
[package integration examples](../packages/jank/README.md#optional-gpu-timers).

The host owns the renderer and the adapter. Supply `onSample: profiler.observeGpu`, call
`captureFrame(frameId)` after rendering, then call `profiler.observeGpu(gpu.read())` each host
frame. The callback preserves every completed result when several resolve at once. Reading
each frame updates the displayed status and age even when no new sample arrives. Pass `null`
when there is no profiler frame; an unknown association stays unknown. Recreate the adapter
when replacing the profiler. Clearing the same profiler is safe because its frame IDs do not
repeat. An open panel is not required for recording GPU samples.

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

## Three r186 WebGPU ownership and limits

Await `renderer.init()` before creating this adapter and pass `revision: THREE.REVISION`.
The adapter validates revision 186, WebGPU backend shape and `timestamp-query` support. A
WebGL fallback reports unsupported timing. Three is a host dependency only. The adapter uses
the initialized [Three renderer](https://threejs.org/docs/pages/Renderer.html) and the pinned
r186 timestamp pool's frame IDs, not a guessed correspondence between CPU and GPU frames.

Give this adapter exclusive ownership of render timestamp resolution for that renderer; do
not also call `resolveTimestampsAsync("render")` from another integration. It permits only one
readback in flight. The r186 pool returns the sum for the **last frame in its resolved frame
list**; earlier frames in a batch do not have separately returned durations. The adapter counts
their lost associations as dropped instead of assigning the aggregate to the current frame.
Its label makes clear that Three supplies an aggregate, not individual named passes.

Call `captureFrame` after each renderer frame, passing the associated profiler frame ID. More
than one renderer frame may belong to one profiler frame. At most 600 associations are retained;
an evicted association is reported as `null`. Cached timestamp results are ignored. Toggles
invalidate previous async work; an old completion cannot publish into a newly enabled session.
Device loss reports an error and requires a new renderer and adapter.

Three owns its timestamp buffers and queries. The adapter changes `backend.trackTimestamp`
while enabled/disabled and restores its original value on disposal only if the host has not
changed it since the adapter's last write. It never disposes the renderer or replaces the host's
device-loss callback. Disposal releases its notification callback from the device-loss promise.

## Interpretation and verification

Both adapters report `measurement: "pass-sum"`. They exclude gaps between passes and do not
measure CPU render submission, presentation latency or the entire frame interval. Asynchronous
readback means a recording stopped immediately can lack its final GPU results. Missing timing
is shown as unsupported, disabled, pending or error, never as an invented zero.

Behavioral tests were written and observed failing before implementation. They cover delayed
correlation, stale/cached completions, finite zero, bounds, disjoint/context/device loss,
ownership, observer reentrancy, toggles and repeat disposal. Public contracts compile against
native WebGL2 and the pinned Three types. Isolated package consumers import both optional
entries without Three or junkui installed at runtime.

The real-render test waits for the measured frame to be sealed before stopping capture.
GPU readback can finish during the first open frame; stopping at that point correctly exports
no completed frame. This race was observed during the full browser run and fixed in the test.

The real-render fixtures run in Chromium, Firefox and WebKit. In the local headless run,
WebKit produced WebGPU timings linked to recorded frames. Chromium and Firefox WebGPU, and
all three WebGL2 runs, reported unsupported timing. Those paths verify truthful fallback and
host rendering after disposal, not hardware timing. WebGL2 timing, disjoint events and device
loss remain covered by controlled unit tests rather than real hardware fault injection.

`pnpm bench` measures the unchanged collection/capture paths; it does not measure driver query
cost, GPU readback latency or adapter overhead. Browser integration success is not a GPU
performance benchmark or a claim of support on every browser/device.

The completed slice passes `pnpm check` (154 unit cases), coverage floors, `pnpm test:package`
and 117 browser cases. The exported `0.2.1-rewrite.2` tarball also passed offline installation,
isolated types/imports and mounted-panel/export/disposal checks in all three engines. The
[collection benchmark](verification/gpu-adapters-collection.json) records fifteen 5,000-frame
samples per workload on an Apple M3 Max. Median incremental cost was 0.274µs for frame-only
collection and 2.339µs with eight scopes per frame; these are batch means, not tail latency.

The optional Knip diagnostic still reports HTML-driven fixtures/demo/gallery as unused, plus
existing development tools, draft exported types and the benchmark's Vite-served source URL.
Those entrypoints need explicit Knip configuration; this diagnostic is not a passing release
gate, and this adapter change does not remove unrelated tooling or draft contracts.
