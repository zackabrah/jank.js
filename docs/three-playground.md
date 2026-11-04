# Three.js probe playground

Run `pnpm dev`, then open [WebGL2](http://localhost:5173/checks/three.html?backend=webgl2)
or [WebGPU](http://localhost:5173/checks/three.html?backend=webgpu). The main preview
also links here. Backend links open new tabs to preserve captures. Test one
foreground tab at a time.

## Workloads

Both backends animate the same instanced shapes and grid with shared resources.

| Control             | Effect                                                         |
| ------------------- | -------------------------------------------------------------- |
| Baseline            | 144 instances, one scene render; resets settings and resumes   |
| CPU stress          | Adds a 14 ms budget of simulation math per frame               |
| GPU stress          | 1,024 instances, four scene renders, 1.5× resolution           |
| Mixed               | 10 ms CPU work, 512 instances, three renders, 1.25× resolution |
| Inject CPU spike    | Queues one 80 ms workload for capture testing                  |
| Pause workload      | Stops simulation and drawing; collection continues             |
| GPU timing probes   | Toggles native queries while rendering continues               |
| Show instanced mesh | Hides/shows the batch; simulation and grid rendering continue  |

Capture → Instrumentation provides the same GPU timing setting and a Trace events
switch. The panel and playground checkbox stay synchronized. Trace events sends
real CPU scopes and event markers to browser performance tools; start a DevTools
recording separately to inspect them. Both settings remain host-owned while the
panel is frozen, and changing them does not stop a recording. Unsupported GPU
timing and a stopped renderer disable the panel control with an explanation.
Changing GPU timing rejects pending queries; captured coverage retains that
evidence instead of implying that every submitted pass was timed.

LIVE → Events lists workload changes, pause/resume, GPU setting changes, injected
spikes and renderer failures, including their timestamps and details. Graph
diamonds mark events within measured frame intervals. Hover or keyboard-inspect
the full rail; Freeze holds events with frames. Events remain available even when
Trace events is off. An injected spike event describes the queued workload, not
proof that all delay in its frame was caused by that workload.

### Renderer faults

**Trigger shader error** deliberately submits invalid GLSL through the WebGL
material or invalid WGSL to the owned WebGPU device. **Trigger validation error**
(WebGPU only) creates an invalid buffer inside an error scope. Both stop this
scene, save an active recording and keep earlier captures accessible. Freeze
holds the display; resume it to inspect new events. Reload starts a fresh session
and clears in-memory captures, so export anything needed first.

LIVE → Events and manual recording exports retain bounded driver messages:
WebGL program/vertex/fragment logs, WebGPU backend errors, scoped errors, async
render/compute pipeline rejection and device-loss reasons. Error details use the
collector's event timestamp and include the nearby collector frame ID. WebGPU and
context-loss notifications are asynchronous: their originating frame is unknown.
The event graph locates receipt time, not the operation that caused the error.
A failure after the last sealed frame remains unmatched; no frame is fabricated.
Reports arriving after a capture stops remain in LIVE history, not that saved file.

`devtools/three-errors.ts` chains existing renderer callbacks, including Three's
device-loss state update. WebGL shader checking stays host-controlled; without a
custom callback, bounded logs also reach the console. The WebGPU observer wraps
only the owned device's public `popErrorScope` and async pipeline methods, returning
their original promises and errors. It adds no error scopes or shader-compilation
queries during normal rendering. Teardown restores owned hooks, preserves later
host replacements and ignores late results. No global console or prototype hooks
are used. Creation failures before the renderer starts still use the startup alert.

Sliders allow 0–24 ms additional CPU work, 1–2,048 instances, 1–8 renders and
0.5–2× CSS pixel resolution. Framebuffer dimensions are capped at 2,048 pixels.
Repeated renders show the same scene; draw-call/triangle counters include all
repeats. More GPU work also costs CPU submission time. Warm up, then vary one
control at a time; presets do not prove a device's bottleneck.

## A/B comparison

Open the panel's **Compare** tab. A is Baseline and B defaults to CPU stress. The
**Baseline vs …** links open GPU stress or Mixed in a new tab, because a comparison's
variants are fixed when it is created. Custom slider values are not offered as variants.

Trials switch the real workload at a sealed frame boundary. Stress controls lock during
a run; Loading checks stay available. A run resumes a paused scene, shows a hidden mesh
and clears a queued spike, because otherwise the trial would not run what its variant
reports. All of it returns when the run ends, however it ends. GPU timing and Trace
events stay as you set them and are not variant settings.

The first setting that differs is the change under test. GPU stress and Mixed change
several settings, so the panel reports the others as confounds: their differences
cannot be attributed to one change. A renderer failure ends the run as **Failed** with
its cause, and finished trials stay exportable. Verdicts describe this device, display
and run; see [the measured results](performance.md#ab-comparison-on-real-hardware).

## Loading and compilation

Use **Loading checks → Load + compile**, then open the panel's **Loading** tab.
Two small JSON assets load concurrently through an owned Three.js `FileLoader`
and `LoadingManager`. They configure a cyan shape, which is decoded, prepared
with `renderer.compileAsync(object, camera, scene)`, and added only after success.
Repeating replaces the previous object and disposes its geometry/material.
The regular stress scene is never precompiled on startup.

**Load missing asset** produces a real HTTP 404 and a failed session without
stopping rendering or capture. **Cancel loading** seals the observed cutoff and
aborts the owned file loaders. It preserves the last successful asset. Compilation
has no cancellation API: the candidate and renderer remain alive until settlement,
then are cleaned up without publishing a cancelled result. Renderer faults mark
active preparation Failed while retaining the existing capture-failure behavior.

The first explicit preparation uses **Editor**, because its renderer is already
active. Later attempts use **Warm · repeat**. There is no cold-context claim or
comparison key: browser/driver caches are not reset. Hosts can supply a cold key
only for genuinely comparable fresh-context runs. The sample does not change
Three's global Cache, default manager, loader prototypes or GPU query ownership.

The waterfall uses observed manager `itemStart`/`itemEnd`/`itemError` offsets plus
explicit decode and compile stages. Item counts are manager observations, not
byte progress. Received bytes come from completed ArrayBuffers; cache hit/miss
and shared-request outcomes remain unknown. WebGPU's supported `compileAsync`
progress reports work items; WebGL supplies the operation duration without that
progress. Compilation wall time is not GPU execution time.

`devtools/three-loading.ts` owns eight sealed sessions and current observations,
chains the original manager methods and preserves its callbacks. Same-URL overlap
has no unique completion identity, so its offsets are omitted rather than guessed.
The host must drain old manager items before starting another session. Separate
run handles prevent stale compilation/byte/progress updates reaching a replacement
session. `three-loading-demo.ts` owns assets, aborts and publication; the shared
panel reads snapshots at its existing measured refresh cadence. Freeze and
recording remain independent of loading.

The API behavior is verified against installed Three.js r187 and its
[LoadingManager](https://threejs.org/docs/pages/LoadingManager.html) and
[Renderer](https://threejs.org/docs/pages/Renderer.html) documentation. The loader
and compile observers do not improve GPU timestamp accuracy.

## Renderer counters

Open LIVE → Counters. Values are grouped by CPU simulation and Render submission;
Freeze holds the completed frame's values. Both backends report draw calls,
triangles, lines, points, geometries and textures. WebGL reports linked programs;
WebGPU reports shader stages separately because these are different resources.
Unsupported fields display Unavailable, while a measured zero remains `0`.

WebGPU also reports per-frame render/compute calls, render targets, tracked buffer
counts and storage estimates. `renderCalls`/`computeCalls` use Three's frame counters,
not lifetime totals. A render call is not a draw call or native GPU pass; internal
output-conversion work can increase the counts. The scene has no compute workload,
so its supported compute-call counter is zero. Nonzero compute mapping is unit-tested.

Byte fields are **estimated tracked storage**, not total device VRAM. Three's
texture/buffer estimates omit untracked allocations and driver overhead; shader
source estimates describe source size, not compiled GPU binaries. WebGL does not
supply these byte fields. No additional GPU resources or timing queries are created.

The scene owns `autoReset = false` and resets `renderer.info` once before each
frame's work. `readThreeCounters` only reads it. All scene repeats accumulate;
pause produces zero work counts while allocated resource counts remain. Values are
copied after completed work and before the collector seals that frame on the next
tick. `frameId` identifies the originating collector frame; capture samples retain
that ID at the collector's 250 ms sampling cadence. The exported current-system
snapshot may be newer than the last sealed frame; use timestamped samples for
historical correspondence.

`passes` counts completed scene repeats (zero when paused); `widthPx`/`heightPx`
describe framebuffer dimensions. CPU `extraWorkMs` is the configured extra-work
budget, not measured CPU duration. Older recordings with `instances` retain its
configured-count meaning; `width`/`height` remain valid without inferred pixel units. Export
retains raw scalar values and unavailable `null`s without a schema change; detailed
counter inspection in the viewer remains planned.

### Visibility and instances

The **Configured instances** slider requests a batch size; **Show instanced mesh**
controls the batch's `visible` flag. Baseline and stress presets restore visibility.
LIVE → Counters → Render submission distinguishes:

| Counter                    | Meaning                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| Configured Instances       | Requested slider/preset count.                                              |
| Active Instances           | Current `InstancedMesh.count`; applied when simulation next runs.           |
| Instance Capacity          | Allocated instance-matrix capacity, currently 2,048.                        |
| Mesh Visible               | The mesh's own visibility flag, not a pixel-visibility measurement.         |
| Frustum Culling Enabled    | Mesh-level Three.js culling; disabled for this animated batch.              |
| Instance Draw Calls        | Observed draws of this batch in the completed frame.                        |
| Unique Submitted Instances | Distinct instance indices submitted at least once in that frame.            |
| Submitted Instances        | Total instance submissions across repeats, including repeated indices.      |
| Visible Instances          | Unavailable: no per-instance clipping/occlusion or final-pixel measurement. |

For example, GPU stress submits 1,024 unique instances four times: 4,096 total
submissions. Hiding or pausing produces zero submissions while retaining configured
and active counts. Changing the count while paused updates the request; the active
count changes on resume. A paused canvas can still display its previous image, so
zero submissions must not be interpreted as zero visible pixels.

`devtools/three-instances.ts` observes this owned opaque batch's before/after-render
callbacks and renderer draw-count deltas. It excludes the grid and WebGPU output
conversion, chains existing callbacks and restores only owned hooks. It neither
traverses instances nor adds GPU queries. Unique counts refer to the batch's contiguous
instance indices, not distinct objects in an arbitrary scene. Unexpected multi-draw
callback patterns yield unavailable counts; nested rendering/custom pipelines need
separate integration before reusing this observer. Submission is CPU-side evidence,
not proof of GPU completion or pixel visibility. Values are latched with the same
frame ID as renderer counters and retained in existing recording samples.

## Measurement boundaries

- **CPU simulation:** math and instance-transform updates.
- **CPU submission:** synchronous render calls, including shader/pipeline setup
  encountered there. This is not GPU completion time.
- **WebGL2:** elapsed queries enclose each scene render, including its internal work.
- **WebGPU:** timestamps on actual render/compute pass descriptors, including
  Three.js's output-conversion pass. Native pass count can exceed scene repeats.

The WebGPU bridge wraps only its owned device's command-encoder factory, restores
it on disposal, and preserves the native device identity. No global prototypes or
private Three.js methods are patched. Three.js timestamp tracking stays off to
avoid competing owners. Resolution/copy commands are submitted after rendering;
asynchronous readback never blocks the animation loop. The scene uses render
passes; compute interception has unit coverage, not a live compute workload.

GPU records retain the collector's exact frame IDs. Manual IDs are tracked as
CPU frames seal; automatic windows come from the existing rule adapter. The
normal panel, capture/export and viewer are reused. Paused frames have explicit
empty GPU inventories. Renderer failure preserves the panel and saved captures.

Unsupported, disabled, pending and rejected results remain explicit; zero is a
valid measurement. Precision remains unknown. GPU sums are not utilization.
Probe disabling removes queries/readbacks but still records frame metadata;
this is not a calibrated benchmark of all instrumentation overhead.

## Temporal history

This scene renders directly, with no temporal accumulation pass or history buffer.
Its Render submission counters therefore report `temporalEnabled: false` and
`null` for history validity, age and reset reason. Pause/resume, mesh hiding and
GPU timing changes do not invent history resets. The fields are latched with the
other completed-frame counters and retained by captures.

Hosts with temporal pipelines supply their own values using the
[temporal counter convention](../CONTRIBUTING.md#temporal-history-supplied-by-the-host).
The LIVE review page provides labelled synthetic valid/reset states; those values
are never substituted into this real scene.

## Jarvis

WebGL2 can use the Mac's LAN/Tailscale HTTP address when Vite listens there.
WebGPU needs HTTPS or localhost. If SSH to the Mac is already available, replace
`YOUR_MAC_SSH_HOST` with that destination and run on Jarvis:

```sh
ssh -N -L 15173:localhost:5173 YOUR_MAC_SSH_HOST
```

Open `http://localhost:15173/checks/three.html?backend=webgpu`. Rendering and
measurements then run on Jarvis; the Mac serves source. This project does not
enable network services or unsafe browser flags.

## Checks and bundle

Remaining inspector hooks and
the optional timestamp-source evaluation are tracked in the
[Three.js adapter backlog](build-plan.md#threejs-adapter-backlog).

- `pnpm test:e2e`: stress, pause/resume, CPU scopes, spike capture, GPU frame-ID
  exports and explicit unsupported states. Headless Chromium here lacks a
  WebGPU adapter and WebGL timer extension.
- `pnpm test:e2e:gpu`: installed Chrome, visible window, one worker. Requires
  native timed captures for both backends; unavailable hardware fails this run.
  Also checks probe toggling from both controls, real trace entry emission and
  disabling, LIVE event inspection/export, renderer counter accumulation and
  pause behavior, frame-linked counter samples, and capture/event preservation
  after WebGL context loss. Native fault tests exercise actual GLSL/WGSL compiler
  errors and scoped buffer validation while recording/frozen, then parse exported
  details and verify earlier captures survive. Intentional fault console errors
  are expected; uncaught page errors still fail the test.

Loading checks exercise both native renderers with real files and compilation,
plus an HTTP 404, cancellation, repeat preparation and recording while frozen.
Requests are held by Playwright only to make the in-progress/cancelled states
deterministic; the application adds no artificial loading delay. Unit tests cover
same-URL ambiguity, callback restoration, late completion, original errors,
compilation rejection, candidate disposal and replacement preservation.

An isolated observer benchmark in installed Chrome measured a median 0.20 ms
for 10,000 unobserved no-op item start/end pairs versus 3.60 ms with the observer
(seven warmed batches): approximately 0.34 µs additional bookkeeping per pair.
Reading a detached four-operation snapshot took approximately 2.9 µs (seven
batches of 1,000 reads). These figures exclude network, shader work, panel/model
rendering and GPU probes; they are local overhead estimates, not load speedups.

Unit tests verify callback chaining, bounded logs, original promise/descriptor
identity, restoration, later host replacements and silent late results. Device
loss and async compute-pipeline rejection are tested with controlled callbacks;
hardware device loss and a real compute workload have not been forced.

The native run passed on an Apple Metal 3 non-fallback WebGPU adapter. Accuracy
has not been calibrated against an external profiler; Safari, Firefox and
Jarvis hardware remain untested.

Three.js 0.187.0, matching types and WebGPU types are exact development dependencies.
The playground is outside production entries. The normal runtime guard still
permits only Preact. Against `2663044`, initial app assets are 129,367 raw / 39,361
gzip bytes (+3 / +1 for the development-link condition); viewer assets are unchanged
at 69,257 raw / 23,460 gzip bytes. No Three.js runtime enters either bundle.

API references: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html),
[WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer),
[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html),
[timestamp query pool](https://threejs.org/docs/pages/WebGPUTimestampQueryPool.html),
[WebGPU specification](https://www.w3.org/TR/webgpu/).
