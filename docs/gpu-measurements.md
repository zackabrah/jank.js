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

WebGPU reduces timestamp precision; nanosecond units do not imply nanosecond
accuracy. Actual adapter resolution stays unknown unless the host
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
installed Chrome. Its integration cases verify operation; `e2e/hardware-gpu.spec.ts`
also verifies native-query conversion, workload scaling, capacity and loss handling,
and probe on/off recordings. Before trusting optimization claims, repeat warmed
scenes, retain spikes and missing rates, and compare GPU distributions with frame
pacing/throughput. See the
[WebGPU timing experiment](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)
for why timestamps alone do not establish application performance.

## Measured hardware results — 5 November 2026

Chrome 156 on macOS 26.5.2 (Apple M3 Max, 30 GPU cores) and Windows 11
(AMD Radeon RX 7800 XT, driver 32.0.21042.62) passed all 12 integration cases and
all four hardware cases per machine. The [measured report](verification/hardware-gpu.json)
retains source hashes, environment, scaling blocks, overhead comparisons and artifact paths.

| Device | API | Retained frames | Maximum native-duration difference | 4× work / 1× work, primary blocks |
| --- | --- | ---: | ---: | ---: |
| Apple M3 Max | WebGL2 / Metal | 480 | 0 ms | 3.88–3.93× |
| Apple M3 Max | WebGPU / Metal | 480 | 0 ms | 3.89–4.08× |
| Radeon RX 7800 XT | WebGL2 / D3D11 | 480 | 0 ms | 3.87–3.88× |
| Radeon RX 7800 XT | WebGPU | 480 | 0 ms | 4.17× |

Across 96 on/off recordings, 19,456 CPU frames retained exact GPU frame links.
All 9,724 frames captured with probes enabled had complete timing coverage after
finalization. Disabled work stayed omitted, and 4,080 valid zero-duration pass
measurements remained measured zero. Exports preserved the GPU evidence exactly.

No median instrumented CPU difference was resolved in these recordings.
Frame p95 differences ranged from −0.05 to +0.15 ms and stayed within observed
same-setting variation. These largely display-paced runs do not prove zero probe
cost or GPU-bound throughput neutrality. The Mac verification rerun, overlapping
repository CPU checks, retained exact native agreement but showed WebGPU scaling
of 3.0–4.0×; it is preserved separately in the report.

Both WebGPU backends returned durations on an observed 0.065536 ms grid. That is
an observed representation pattern, not a resolution guarantee or calibration.
Small workloads were much noisier relative to this grid, so the scaling fixture
uses longer shaders and dispatches. Repeated opaque draws and empty compute passes
were unsuitable calibration workloads; see the fixture notes in the report.

**Reporting gap found:** the CLI currently suppresses WebGL GPU pass summaries
when no start/end span exists. A hardware capture with 290/290 complete frames
returns `spanMs: null` (correct) but also `passSumMs: null` and `passes: []`, despite
valid elapsed timings. The panel and exported invocation records retain those
durations. This validation change leaves that separate reporting issue open.

## Reproducing hardware validation

Run `pnpm test:e2e:gpu` on an idle interactive desktop with installed Chrome. It
uses one worker and no unsafe GPU flags. Unsupported timers and software adapters
fail the accuracy cases rather than counting as passes. The normal headless suite
skips these hardware-only cases.

The accuracy fixture renders at 1024 × 1024, with additive blending so repeated
draws cannot be removed as hidden opaque work. WebGPU also dispatches a storage-buffer
compute workload. Three A–B–B–A blocks compare one versus four repetitions, with
16 warm-up and 40 retained samples per trial. Every WebGL duration is checked
against the native elapsed-query value. WebGPU query sets are independently
resolved into separate buffers and checked against Jank's durations and relative
endpoints. Raw nanoseconds are retained as strings. CPU submission-to-readback
completion is only an upper bound on an individual GPU pass, not an equal clock.

The lifecycle cases exercise the 32-pass limit, the WebGPU eight-slot readback
pool, timing toggles, native WebGL loss/restoration and WebGPU device destruction.
Real disjoint events and driver resets are not forced; their failure paths also
have unit tests. Empty frame inventories are separate from timestamped passes
that contain no commands: a backend may return unusable timestamps for the latter.

Separate playground trials compare probes off/on/on/off in three blocks for each
of Baseline and GPU stress: one second warm-up and two seconds recording per trial.
They check exact CPU/GPU frame matching, missing versus measured values, drained
pending queries and export/import fidelity. The agent report is read first; raw
recordings and `overhead.json` retain the evidence. Read changes beside the
variation between same-setting trials, especially when frame pacing is display-limited.
Disabling probes removes native queries/readbacks but leaves recording and metadata;
this is not the cost of removing all instrumentation.

`accuracy.json`, `overhead.json` and recording files are saved in each Playwright
test's output directory. These tests establish correct use of browser-exposed
timers and sensitivity to workload, not independent calibration of GPU clock
frequency or whole-device utilization. Native timestamps still inherit browser
precision, driver behavior, scheduling and power-state effects.

For another machine, start `chromium.launchServer({ channel: "chrome", headless:
false, host: "127.0.0.1", port: 9232 })` from the **interactive desktop** using the
same Playwright version as this checkout. Print its `wsEndpoint()`. Forward that
loopback port locally and reverse-forward the development server:

```sh
ssh -N -L 9232:127.0.0.1:9232 -R 4178:127.0.0.1:4178 <windows-host>
JANK_GPU_WS=ws://127.0.0.1:9232/<returned-path> pnpm test:e2e:gpu
```

Use the Playwright server protocol here, not a CDP URL: downloads must be
transferred between machines. The tests use `saveAs` so local and remote downloads
follow the same assertions. Keep the endpoint private and close the test browser
and forwarding sessions afterward.
