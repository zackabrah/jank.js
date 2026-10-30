# jank.js test preview

Version **0.2.1-rewrite.2** is a local test build of the readability rewrite. It includes the
profiler, live panel, recording capture/export, optional GPU timers, bundled UI styles and TypeScript declarations.
It has zero runtime dependencies. The package contains no demo scene, Three.js, private assets
or development tooling. It is ESM and targets modern browsers.

## Install

From the application where you want to test it:

```sh
pnpm add /path/to/jank.js-0.2.1-rewrite.2.tgz
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
const panel = createPanel({ container: document.body, profiler, mode: "full" });

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

The panel provides REC / STOP REC, automatic hitch capture, FREEZE / RESUME, CLEAR, and
EXPORT JSON. Freezing affects the display while collection continues. Removing the panel
preserves captures; disposing the profiler ends that profiler's lifetime.

For programmatic capture, call `profiler.capture.start()`, collect frames, then call
`profiler.capture.stop()`. It returns a recording or null. `serializeRecording(recording)`
produces validated JSON; `parseRecording(json)` returns an explicit success/error result.
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
128 retained results. Options `maxPasses`, `maxPendingFrames`, `readbackTimeoutMs` allow maxima of
256, eight and 10s. Capacity/queue pressure produces explicit omissions. Pass IDs/labels/categories
are bounded to 240 characters. All available results reach `onSample`, including out-of-order
completions. `read()` keeps the newest result and current age. An unsupported feature or WebGL
fallback is shown explicitly. Other Three revisions are rejected.

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
the adapter retains pending results. Panel STOP/EXPORT remain synchronous.

## Preview limits

- The API and recording schema may still change. This preview writes schema version 4 and
  does not import older recording formats.
- The offline viewer and panel-to-viewer handoff are not implemented yet.
- Loading runtime, visibility/temporal controls and debug bounds
  overlay are not implemented yet. Their draft types are not working runtime factories.
- Host-provided loading/GPU sources and a trace sink can be connected. GPU timing requires a
  connected adapter or actual host measurements; no simulated samples ship here.
- “Unattributed” is frame time outside recorded scope intervals, including browser wait and
  idle time. It is not a measurement of unexplained CPU work.
- Overhead readouts measure synchronous collection and refresh; they exclude deferred paint
  and GPU work.

The MIT license included in the archive covers this package and its bundled junkui code.
