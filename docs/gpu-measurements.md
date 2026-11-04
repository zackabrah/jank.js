# GPU measurement integration

GPU records measure registered render/compute invocations. They do not measure
whole-device utilization, browser compositing, presentation latency or CPU
submission time. No rendering library or extra runtime dependency is required.

## Evidence and compatibility

`src/gpu/model.ts` defines `GpuFrame`: an explicit diagnostic frame ID, GPU clock,
timing epoch, source, optional known resolution and invocation records. Each
invocation is timed, pending, rejected or omitted, with reasons for failures.
Zero is a valid duration, including work below timer resolution. Missing is never
zero. Only set `inventory: "complete"` when the host registers **every** render and
compute invocation; otherwise use the default `unknown`. Complete-empty means
none submitted. Capacity omissions always prevent complete coverage.

`gpuFrameToLive(record, currentDiagnosticFrame)` supplies the existing panel.
`timedWork` is a sum of timed pass durations; overlaps can double-count. Span
requires a complete set of start/end timestamps and includes gaps. GPU timestamps
have their own origin; never align them with `performance.now()` or CPU lanes.
The old `LiveGpu.busy` field is retained for compatibility and is not a pass sum.

LIVE and the selected recording frame share **Why this coverage?**. It explains
the declared inventory, valid/pending/rejected/omitted counts and individual
reasons. Render/compute fractions cover retained invocation records only; bounded
overflow has no retained kind or individual reason. Unknown inventory cannot
become complete just because all retained results are timed. A valid timed zero
is distinct from missing work, and explicit complete-empty means none submitted.
LIVE validates supplied evidence and rejects summary counts or sample IDs that
contradict it. Use `gpuFrameToLive` to keep them consistent.

Legacy summaries without evidence state that coverage/rejection causes cannot be
verified. Dropped source frames, when reported, are labelled separately from
rejected/omitted invocations. Aggregate Capture bars retain frame counts; a missing
frame record has no recoverable cause and never implies a specific query failure.

Recordings retain version 2 with optional `gpuTiming: { version: 1, frames }`.
The parser checks identities, states, numbers, intervals, record bounds and a
single epoch. Old files retain unknown/not-recorded coverage. The existing
Three r186 aggregate adapter remains a legacy source: its render sum does not
establish per-invocation coverage. Use native pass hooks for richer evidence;
do not infer completeness or compute timings from that aggregate.

## WebGL2 host

```ts
import { createGpuHistory } from "../src/gpu/history.ts";
import { gpuFrameToLive } from "../src/gpu/model.ts";
import { createWebGl2GpuSource } from "../src/gpu/webgl2.ts";

const history = createGpuHistory(6000, () => gpu.poll());
let latest: Parameters<typeof gpuFrameToLive>[0] | null = null;
const gpu = createWebGl2GpuSource(gl, (record) => {
  history.record(record);
  if (!latest || record.frameId >= latest.frameId) latest = record;
});
// Add this BEFORE wrapping the collector with createRuleCaptureSource:
const captureSource = {
  ...monitor,
  gpuCoverage: history.coverage,
  finalizeGpu: history.finalize,
};

// In the host-owned frame loop:
const diagnosticFrame = monitor.beginFrame(performance.now());
gpu.beginPass("Main scene");
renderer.render(scene, camera);
gpu.endPass();
monitor.endFrame(updateMs, renderSubmissionMs);
gpu.captureFrame(diagnosticFrame, "complete");
panel.refresh(performance.now());
```

Pass `() => latest ? gpuFrameToLive(latest, currentDiagnosticFrame) : null` to
`mountDiagnosticsPanel`'s GPU reader. Keep `history.record` connected at collection
frequency even when the panel is frozen or unmounted. Queries cannot nest; this
adapter exclusively owns elapsed queries on the context. It caps timed passes at
32/frame and outstanding frames at 64. Allocation failures, pool overflow,
context loss and disjoint events remain visible. A disjoint check invalidates the
whole outstanding batch. Restoration reacquires the extension. Call `dispose()`
at host teardown; it does not dispose the host context.

## Buffer and coverage metadata

Capture reads these optional `CaptureSource` fields at display rate:

- `recentFrameCapacity`: the host's recent CPU history capacity, distinct from
  the recording's `frameCapacity`. Omit it when unknown; the panel shows the
  retained count without a fraction or meter.
- `gpuCoverage(frameIds)`: return coverage for exactly these CPU frame IDs.
  `history.coverage` reads bounded GPU history without cloning pass records.
  Missing records stay missing; an explicit empty, complete inventory counts as
  complete. Unknown inventory remains unknown, even if every received pass timed.
- `recordingFrameIds()`: return all IDs in the current recording, including
  pre-trigger frames, or `null` when unavailable. Read the host's recording
  buffer directly; do not serialize a recording on each refresh.
  `createRuleCaptureSource` supplies its own automatic window and delegates
  manual IDs to the underlying host. Without this hook, manual coverage stays
  unavailable instead of substituting the shorter recent buffer.
- `gpuPool()`: return `{ free, total?, unit: "passes" | "samples" }`, or `null`.
  These are retained GPU detail slots, not GPU memory, utilization or native
  query/readback slots. Omit `total` when the host only knows the free count;
  the panel then shows free counts without a capacity bar. Native timer adapters
  and GPU history do not claim a fixed pass/sample pool.

Counts and window lengths are validated and cached with the display snapshot;
rendering between host frames cannot mix old counts with new recording IDs.
A failed metadata read shows a local
notice and does not interrupt capture or saving. Finalizing uses the held CPU
window while recent history continues advancing; saved coverage uses the owned
recording, shared with the viewer.

The development preview declares the collector's verified 600-frame
recent capacity. It has no GPU source, so GPU coverage/pool remain unavailable.
`/checks/gpu.html` supplies labelled synthetic evidence and pool counts: dark has
a total, light has only a free count. Neither is a hardware measurement.

## WebGPU host

Request the optional `timestamp-query` feature when creating the device, only
when the adapter supports it. Create `createWebGpuSource(device, onFrame)` from
`src/gpu/webgpu.ts`, feeding `onFrame` into the same history/reader pattern above.

```ts
gpu.beginFrame(diagnosticFrame, "complete");
const encoder = device.createCommandEncoder();
const render = encoder.beginRenderPass({
  ...renderDescriptor,
  timestampWrites: gpu.timestampWrites("Scene", "render"),
});
// Host draw calls…
render.end();
const compute = encoder.beginComputePass({
  timestampWrites: gpu.timestampWrites("Simulation", "compute"),
});
// Host dispatches…
compute.end();
gpu.endFrame(encoder); // Encodes resolve/copy after the actual passes.
device.queue.submit([encoder.finish()]);
gpu.readSubmittedFrames(); // Starts asynchronous readback; do not await per frame.
```

Use returned timestamp writes on the actual submitted passes. Registering a pass
without submitting its writes is a host error: unwritten zero query slots cannot
be distinguished from valid quantized zero durations. Submit each sealed frame
before `readSubmittedFrames`; cancelled encoders require source disposal and a
fresh source/history. The adapter owns eight reusable query/readback slots, each
with 32 timed passes. It records up to 256 invocation details, counting additional
omissions. Query resources are adapter-owned; the device remains host-owned.
Create a new history when replacing the device/collector or restarting frame IDs.

Current WebGPU rules coarsen timestamps to 0.1 ms or more; nanosecond units do not
imply nanosecond accuracy. Actual adapter resolution stays unknown unless the host
has evidence. Cross-origin isolation does not improve GPU timestamp precision.
Negative deltas are rejected; large origins are subtracted as bigint first.
Sources: [WebGPU timestamps](https://gpuweb.github.io/gpuweb/#timestamp-query),
[High Resolution Time](https://www.w3.org/TR/hr-time-3/#dfn-coarsen-time), and
[Khronos timer queries](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).

## Capture lifecycle and review

Attach `finalizeGpu: history.finalize` to the capture source. The controller owns
and freezes the CPU export first, blocks replacement, and enters Finalizing GPU.
The history retains pre-trigger records and polls only outstanding captured
queries for at most 500 ms (plus a browser scheduling turn). Later CPU frames do
not extend the capture. Timeout/restart turns pending invocations into rejected
records with reasons. Discard aborts finalization; failure preserves the owned
recording for retry. Auto stays disarmed during finalization and resumes after
the original cooldown. Keep calling `controller.refresh` from the host loop.
A custom host finalizer that hangs is aborted after one second and leaves the
capture available for retry. Legacy sources without the hook retain synchronous saves.

`/checks/gpu.html` reviews complete-zero, complete-empty, unknown, rejected,
omitted and mixed/overflow evidence plus capture finalization in dark/light. Start recording,
advance a pending frame, stop/save, then resolve queries or let the deadline
expire. The WebGL smoke button checks available native timer operation.

Unit tests cover driver/result failures, disjoint batches, out-of-order readbacks,
resource bounds, device loss, precision, codec validation and capture lifecycle.
Playwright checks capture/viewer coverage, export/import and cancellation.
The default headless Chromium checks expose neither a WebGPU adapter nor WebGL
timer queries. `pnpm test:e2e:gpu` additionally exercises both native sources in
installed Chrome; this verifies operation, not timing accuracy. Before
trusting optimization claims, validate on physical GPUs: repeat warmed scenes,
compare instrumentation on/off, retain spikes and missing rates, and compare
GPU distributions with frame pacing/throughput. See the
[WebGPU timing experiment](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)
for why timestamps alone do not establish application performance.
