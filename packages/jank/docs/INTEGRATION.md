# Integration guide · jank.js 0.2.1-rewrite.6

Version **0.2.1-rewrite.6** is an unstable source preview of the rewrite, distributed as a local archive. It includes the
profiler, live panel, recording capture/export, optional GPU timers, bundled UI styles and TypeScript declarations.
It has zero runtime dependencies. The package contains no demo scene, Three.js, private assets
or development tooling. It is ESM and targets modern browsers.

## Install

From the application where you want to test it:

```sh
pnpm add /path/to/jank.js-0.2.1-rewrite.6.tgz
```

Use the actual downloaded archive path. npm and other package managers can also install this
local tarball. No registry publication or separate `junkui` installation is required.

## Connect your frame loop

Import the CSS once through your application's bundler, then create one profiler and panel
after the document body exists:

```js
import { createPanel, createProfiler } from "jank.js";
import "jank.js/styles.css";

const profiler = createProfiler({
  application: { name: "My application" },
  targetFps: 60,
});
const update = profiler.createChannel({ id: "update", label: "update" });
const render = profiler.createChannel({ id: "render", label: "render submit" });
const panel = createPanel({
  container: document.body,
  profiler,
  mode: "full",
  // Serve the bundled HTML from this same-origin URL for direct handoff.
  viewerUrl: new URL("/jank-viewer.html", location.href).href,
});

// Integrate these calls into your existing animation callback.
function onFrame(timestampMs) {
  profiler.beginFrame(timestampMs);

  const updateToken = update.begin();
  // Your existing simulation/update work goes here.
  update.end(updateToken);

  const renderToken = render.begin();
  // Your existing renderer call goes here.
  render.end(renderToken);

  panel.refresh(timestampMs);
}

// When your integration is removed:
function disposeProfiling() {
  panel.dispose();
  profiler.dispose();
}
```

Your application owns and invokes the loop; jank installs no animation loop and never disposes
your renderer. Use the browser's `requestAnimationFrame` timestamp with the default clock.
If supplying a custom `now` clock, frame timestamps must use the same clock and millisecond units.
The next `beginFrame` seals the previous frame; the final open frame is excluded from exports.

FULL and MINI request CPU scopes automatically. To keep collecting scopes in LINE mode or
without a panel, hold `const releaseScopes = profiler.requestScopes()` and call `releaseScopes()`
when finished. Channel rows follow registration order. Timings may overlap; do not add nested
channel totals together. `render submit` measures CPU submission, not GPU execution.

Optional counter providers are passed to `createChannel` as `readCounters: () => ({ count: 42 })`.
Return your actual measurements. Values may be numbers, strings, booleans or null. Use
`profiler.addEvent("Marker")` for timestamped events.

## Record and export

LIVE provides **Capture slow frames** and a saved-capture inspector, without requiring a
separate viewer URL. The inspector reuses the configured GPU resolver and export timeout,
then displays a detached recording. Collection continues; panel removal releases its modal.
Custom and budget-relative presets are applied explicitly; the default remains disarmed at
50 ms. Changing the budget does not silently re-arm an existing threshold.

The panel provides REC / STOP REC, automatic hitch capture, FREEZE / RESUME, CLEAR, and
EXPORT JSON. Freezing affects the display while collection continues. Removing the panel
preserves captures; disposing the profiler ends that profiler's lifetime.

For programmatic capture, call `profiler.capture.start()`, collect frames, then call
`profiler.capture.stop()`. It returns a recording or null. `serializeRecording(recording)`
produces validated JSON; `parseRecording(json)` returns an explicit success/error result.
If the host separately measures update/render CPU totals, call
`profiler.endFrame({ updateMs, renderMs })` after that work using actual durations. This is
optional and does not seal the frame; omit unavailable totals rather than supplying zero.
Recent history retains 600 frames, manual captures hold up to 6,000 frames, and the archive
retains ten completed captures.

## Optional GPU timers

Import only the adapter your renderer uses. For WebGL2, wrap sequential render passes in
timer queries and submit their profiler frame ID after rendering:

```js
import { createWebGl2GpuSource } from "jank.js/adapters/webgl2";

const gpu = createWebGl2GpuSource(gl, { onSample: profiler.observeGpu });
const panel = createPanel({ container: document.body, profiler, gpu, mode: "full" });

function onFrame(timestampMs) {
  const frameId = profiler.beginFrame(timestampMs);
  gpu.beginPass("scene");
  renderer.render(scene, camera);
  gpu.endPass();
  gpu.captureFrame(frameId > 0 ? frameId : null);
  profiler.observeGpu(gpu.read());
  panel.refresh(timestampMs);
}
```

`gl` is your renderer's WebGL2 context. The `EXT_disjoint_timer_query_webgl2` extension must
be available; otherwise the panel reports unsupported timing. Passes cannot overlap or nest.
The adapter owns its queries and polls results without waiting for the GPU.

For **Three.js r186 WebGPURenderer** (verified with 0.186.1), explicitly bracket all compute and
render work. Initialize resources before this synchronous frame path:

```js
import { REVISION } from "three";
import { createThreeWebGpuSource } from "jank.js/adapters/three-webgpu";

await renderer.init();
const gpu = createThreeWebGpuSource(renderer, {
  revision: REVISION,
  enabled: true, // disabled by default
  onSample: profiler.observeGpu,
});

function onFrame(timestampMs) {
  const frameId = profiler.beginFrame(timestampMs);
  gpu.beginFrame(frameId > 0 ? frameId : null);
  try {
    gpu.withPass({ id: "fft", label: "Ocean FFT", category: "water" }, () => {
      renderer.compute(oceanFft);
    });
    gpu.withPass({ id: "scene", label: "Main Scene" }, () => {
      renderer.render(scene, camera);
    });
  } finally {
    gpu.endFrame();
  }
  profiler.observeGpu(gpu.read());
  panel.refresh(timestampMs);
}
```

Multiple calls and repeated native passes remain associated with one application frame. Submit
all command buffers before `endFrame`; do not await readbacks in your loop. `withPass` callbacks
must be synchronous. Work outside the bracket is excluded. The old end-only `captureFrame`
integration is insufficient; that method now closes a matching `beginFrame` bracket.

Jank exclusively owns both timestamp paths for the renderer/device while attached. Do not call
Three's timestamp resolver or attach another timer to that device. It retains raw compute/render
intervals and reports render sum, compute sum, combined sum, interval-union busy time and elapsed
span separately. GPU origins are decimal uint64 nanoseconds; offsets are exact integers. The GPU
clock is unrelated to the profiler's CPU clock. Partial frames have no complete totals.

Defaults: 256 passes/frame, four readback slots (eight buffers/32,768 bytes), 2s readback timeout,
128 retained results for bounded finalization. Options `maxPasses`, `maxPendingFrames`, `readbackTimeoutMs` allow maxima of
256, eight and 10s. Capacity/queue pressure produces explicit omissions. Pass IDs/labels/categories
are bounded to 240 characters. All available results reach `onSample`, including out-of-order
completions. `read()` keeps the newest result and current age. An unsupported feature or WebGL
fallback is shown explicitly. Other Three revisions are rejected.

For dense captures, `sampleEveryNFrames` (default 1, range 1–6000) explicitly samples one
GPU bracket in every N. Skipped frames retain sampled-out markers and are not measured zeros.
The profiler retains at most 6,000 GPU sample records and 16,384 accepted/rejected pass records;
pressure can discard old detail while preserving omission markers. Finalization cannot recover
already-evicted detail. Inspect `profiler.capture.getProgress()` and exported coverage before
interpreting a long capture. The adapter's 128-result cache is distinct from profiler retention.

WebGL2 continues reporting pass sums. Both adapters preserve unknown timing rather than inventing
zero. Dispose in order: `panel.dispose()`, `gpu.dispose()`, `profiler.dispose()`. Host rendering
remains usable. Recreate the adapter when replacing the profiler or recovering a WebGPU device.
The adapter restores prior timestamp settings and destroys only its own resources.

For a stopped WebGPU capture, wait outside your animation callback for bounded finalization:

```js
import { finalizeRecording, serializeRecording } from "jank.js";

const stopped = profiler.capture.stop();
if (stopped) {
  const finished = await finalizeRecording(stopped, gpu, { timeoutMs: 2000 });
  const json = serializeRecording(finished.recording);
  // Save json with your existing export action.
}
```

The loop continues during this wait. Inspect `status` (`settled`, `timeout`, `cancelled`,
`unavailable`, `error`), `complete`, `missingFrameIds`, `incompleteFrameIds`, `omittedSamples`
and `error`. Only sealed CPU frames are eligible. The original capture/archive stays unchanged;
export the returned recording. Missing/partial data marks it truncated. Merge storage is bounded
to 6,000 samples / 16,384 GPU passes, and the timeout is capped at 10s. Finalize promptly while
the adapter retains pending results. Pass `gpuResolver: gpu` alongside `gpu` when creating the panel to enable bounded GPU
finalization for its export/viewer action. `exportTimeoutMs` defaults to 2000. The panel can
stop an active recording and export through one action; it reports pending/missing/partial
results. Without a resolver, it cannot finalize pending GPU results.

## Renderer counters

```js
import { readThreeRendererCounters } from "jank.js/adapters/three-counters";
const rendererChannel = profiler.createChannel({
  id: "renderer",
  label: "Renderer",
  readCounters: () => readThreeRendererCounters(renderer.info, "webgl"),
});
```

Use `"webgpu"` for Three WebGPU: it reads `render.drawCalls`, not cumulative `render.calls`.
The helper returns draw calls, triangles, points, lines, geometries and textures. Missing,
negative or nonfinite observations become null; measured zero remains zero. Resource counts
are not bytes. GPU instance culling can make submission counts upper bounds on executed work.
Jank never changes `autoReset` or calls `reset()`. Counter providers run at `beginFrame`:
poll the last completed render before its next host-owned reset. For multipass rendering,
explicitly own the reset policy so the values cover the passes you intend to measure.

## Loading

```js
import { createLoadingProfiler } from "jank.js";
const loading = createLoadingProfiler();
// Include loading in the options of your one createPanel call.
const run = loading.beginRun({ label: "Scene", kind: "fresh-context" });
try {
  const model = await run.measure("decode", () => decodeModel());
  run.measure("prepare", () => installModel(model));
  run.finish("ready");
} catch (error) {
  run.finish("failed");
  throw error;
}
```

`decodeModel` and `installModel` stand for your existing host operations. For explicit I/O
observations, `run.startStage("fetch")` returns an operation with `recordCache("miss")`,
`addReceivedBytes(bytes)` and `finish()` methods. Cache alternatives are `"hit"` and
`"in-flight"`. Record actual host observations. Finish an aborted operation/run with
`"cancelled"`; call `loading.dispose()` during host shutdown after removing the panel.

Run kinds are `fresh-context`, `repeat-session` and `editor`. Only use fresh-context
when that describes the experiment; it does not prove browser/driver/OS caches were cold.
The first successful fresh run without pending operations becomes the cold baseline.
Stage elapsed time is the union of overlapping operations; combined time is their sum.
These are wall-clock loading measurements, not CPU/GPU execution time. Replacing/finishing
runs seals their data; late callbacks cannot mutate a new run. Loading data is not embedded
in frame recordings. Defaults: eight completed runs, 128 stages and 4096 operations/run.

## Visibility, instance and temporal sources

Pass `visibility` and `temporal` to your existing `createPanel` call. These are borrowed host
objects, not algorithms installed by Jank. Import `VisibilitySource`, `VisibilitySnapshot`,
`TemporalSource` and `TemporalSnapshot` as TypeScript types from `jank.js`.

| Source     | Read contract                        | Host controls                                                                             |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Visibility | `read(): VisibilitySnapshot \| null` | `setEnabled(boolean)`, `setDebugBounds(boolean)`, optional `setInstancesEnabled(boolean)` |
| Temporal   | `read(): TemporalSnapshot \| null`   | `setEnabled(boolean)`, `setDebugView("none" \| "motion" \| "history")`                    |

Visibility snapshots contain `enabled`, `debugBounds`, named `views` with tested/visible/culled
counts, nullable `distance`, and nullable `instances`. Instances contain enabled state,
hierarchy/node/prepared/cache counts and named view samples with candidates, visible, culled,
rejected leaves and nullable `sampleAgeFrames`. Return null when unavailable; do not manufacture
zeros. Missing `setInstancesEnabled` makes that control read-only. Stable names retain row
order; the panel keeps up to 32 names per section.

Temporal snapshots contain `objectMotion`, `debugView`, `eligibleBatches`, `rigidBatches` and
`rejectedBatches`. Both snapshot types accept an optional explanatory `note`. The host owns
motion vectors, history validity and rendering effects. The built declarations provide the
complete shapes. Freeze copies source observations and disables their controls; disposal
removes panel listeners without disposing sources. Exceptions become explicit source errors.
These snapshots are not frame recording fields; register numeric counters if you need history.

## Bounded world-space debug boxes

```js
import { createBoundsOverlay } from "jank.js";
const overlay = createBoundsOverlay(renderer.domElement, { maxBounds: 128 });
// In your existing loop, after camera/world transforms are current:
overlay.render(
  showBounds
    ? {
        bounds: worldBoxes,
        omitted: omittedBoxCount,
        viewProjection: worldToClip.elements,
        clipDepth: "minus-one-to-one",
      }
    : null,
);
// During shutdown:
overlay.dispose();
```

The names in this snippet represent host data. Each box has finite ordered `min`/`max`
three-element arrays and `culled`. The matrix is column-major world-to-clip. Use WebGL depth
`minus-one-to-one` or WebGPU depth `zero-to-one` as appropriate. Edges clip before perspective
division. The overlay owns a pointer-transparent canvas, updates from your loop, defaults to
128 boxes, permits at most 2048 and exposes overflow as `data-omitted`. It is not culling,
picking or an occlusion test; turning on a panel flag must be routed to host drawing logic.

## Repeatable comparisons

Use `createComparison({ profiler, host, gpuResolver })`; omit the resolver for CPU-only
experiments. `host.begin()` snapshots your settings and returns:

- `apply(variant)`: synchronously apply A or B and return context with `label`,
  `settings: [{ label, value }]`, `resolution: { widthPx, heightPx } | null` and `animation`.
- Optional `check()`: return a cancellation reason when the experiment is no longer valid,
  otherwise null.
- `restore()`: restore the settings captured by begin, including after cancellation.

Pass the comparison to your panel or call
`comparison.start({ pairs: 3, warmupMs: 1000, measureMs: 2000 })` yourself.
Immediately after every `const frameId = profiler.beginFrame(timestampMs)`, call
`comparison.tick(timestampMs, frameId)` **before** application work. No extra animation loop
is installed. The controller alternates AB/BA pair order and owns its capture while running;
stop/disarm other captures first. Keep budget, scene state and animation policy controlled.
Export `serializeComparison(comparison.report())` only when the report is non-null; load that
file in the included viewer. Dispose the comparison before the profiler. Closing its connected
panel cancels its active run and restores host state. Paired ranges are descriptive evidence,
not proof of statistical significance or a universal device headroom limit.

## Viewer and cleanup

Copy `jank-viewer.html` from the bundle to your application's static files and set `viewerUrl`
to its same-origin HTTP(S) address. Direct handoff validates origin/window/messages; file URLs
and unsupported origins use download/local import. The standalone file also opens directly
without installation. A custom embedded viewer uses `createViewer({ container })`; retain its
handle and call `dispose()` on removal. Viewer imports accept recording schemas 5/6/7 and comparison
version 1, with a 32 MiB UTF-8 limit. No remote upload is involved.

Dispose owned objects in this order where present: panel, comparison, bounds overlay, GPU
adapter, loading profiler, frame profiler. Release any explicit scope-demand handles. Remove
host callbacks that reference the integration. The host still owns the renderer and frame loop;
never dispose a shared host resource just because its panel was closed. Do not reuse an adapter
with a replacement profiler or lost WebGPU device.

## Measurement and compatibility limits

- This is an unstable ESM source preview for modern browsers. APIs and file formats may change.
  Node is useful for build/analysis; mounting panels requires the browser DOM.
- This build writes recording schema **5** and comparison version **1**. Legacy recording
  files are rejected rather than silently interpreted.
- Scopes are CPU wall time, including any waits. Render-submit scope duration is not GPU time.
  Nested/inclusive channel timings cannot simply be summed.
- Unattributed frame time includes browser wait and idle time; it is not unexplained CPU work.
- Unknown GPU values stay unknown. Capture capacity, sampling, pending queries, disjoint
  results and rejected timestamps can reduce coverage; inspect completeness before comparing.
- Synchronous overhead excludes deferred browser paint/GPU work. The quick headroom test is
  part of the development demo, not an exported hardware-rating API.
- Production rendering, visibility and temporal algorithms remain host-owned. Standalone
  library diagnostics are labelled simulations, not measurements of your application.

The MIT license included in the package also covers its bundled junkui code.

Automatic episodes are opt-in with `capture.arm({ thresholdMs: 25, beforeFrames: 0,
afterFrames: 0, cooldownMs: 5000, timeWindow: { beforeMs: 2000, afterMs: 4000,
recoveryMs: 2000, maxDurationMs: 30000 } })`. Time windows override the two frame-count fields.
The profiler retains the host-owned loop and bounded history; only sealed frames advance the
episode. Finalize a saved episode through the same GPU finalization/export path as other
recordings. Schema 6 preserves its trigger history, settings and stop reason. Existing schema-5
files remain supported; older viewer bundles need the updated viewer to open schema-6 episodes.

To detect sustained slowdown using the profiler’s target FPS, add `sustainedMs: 250` to the
existing `capture.arm` options. `thresholdMs` remains required for spike-mode configuration but
is ignored while sustained mode is selected. Omit `sustainedMs` to return to spike mode.
Sustained captures use schema 7 and retain the actual triggering budget and onset evidence.
Use the matching updated offline viewer; schemas 5 and 6 remain readable.

Include `metadata.toolVersion` when reporting a recording. Its build-metadata suffix identifies
the source commit; the package version itself remains `0.2.1-rewrite.6`. A `-dirty` suffix means
the build contains uncommitted changes. The versioned bundle is built only from clean source.

## Explicit native timestamp probe

Before attaching a GPU adapter, while your host rendering is idle:

```ts
import { runWebGpuTimestampDiagnostic } from "jank.js/adapters/webgpu-diagnostic";

// device was created with requiredFeatures: ['timestamp-query'].
const diagnostic = await runWebGpuTimestampDiagnostic(device, { timeoutMs: 3000 });
// Retain diagnostic.pairs, including reason and raw startNs/endNs strings.
```

This submits six tiny native render passes, comparing drawn and clear-only work with
reused and fresh query storage. It owns and releases only its probe resources; you retain
the device. Timeout applies per read. `finished` means all six probes ran, not that their
pairs passed. Check each rejection reason; unknown duration is `null`. Keep your device
error handler active. A successful probe is not whole-scene timing validation.

The standalone `jank-gpu-diagnostic.html` provides labelled Run/Download controls for
support reports. It uses a separate owned device and needs no app integration or network.
