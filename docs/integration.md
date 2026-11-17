# Integration and adapters

## Ownership

Use one diagnostics monitor per application. The panel is a guest: by default it is `position: fixed` in a corner of the viewport, overlays the page without resizing it, and renders inside its own Shadow DOM, so page styles and panel styles cannot affect each other. Importing any entry is safe without a DOM; creating the panel requires a browser document.

The host owns requestAnimationFrame, renderer settings, clocks and GPU resources. jank.js never creates a second animation loop. Call `monitor.beginFrame(at)` at the start of an application frame, `panel.refresh(at)` straight after it, and `monitor.endFrame(update, render)` when the work is done. `beginFrame` is what seals the previous frame, so refreshing there observes that frame before the next one's work starts. A comparison switches workloads at that boundary too.

`panel.destroy()` removes the UI and listeners and is safe to repeat. A late `refresh` is ignored. It does not dispose the host monitor, change renderer settings or release host resources. It does stop a running comparison and discard unsaved capture state. Dispose the monitor separately with `monitor.dispose()`.

IDs must be unique within a monitor. Timed systems appear as CPU rows in registration order; every system's values appear under Counters.

Recordings can contain application-provided labels and values. There is no network transport: exports download locally and the viewer reads files in the browser. Strip anything private before sharing a recording.

## Systems, events, and recording

```js
const physics = monitor.register("physics", "Physics", () => ({
  bodies: world.bodyCount,
}));
const start = physics.begin();
stepPhysics();
physics.end(start);
monitor.event("Scene changed", "Loading arena");
monitor.startRecording();
// Later:
monitor.stopRecording();
const recording = monitor.export();
physics.dispose();
```

IDs must be unique within a monitor. Timed systems appear as CPU rows in registration order; every system's values appear under **Counters**. A system that only supplies values and is never timed has no CPU row. Readers return number, string, boolean or null values. Providers should be cheap and supply only data the host intends to display/export. `createPerformancePanel` keeps detailed channel timing on while it is mounted. Without it, timing activates after `monitor.setExpanded(true)`, while recording, while armed for capture, or while emitting DevTools tracks. Disabled `begin()` returns a sentinel which `end()` safely ignores.

Recordings can contain application-provided labels and values. There is no network transport: exports download locally and the viewer reads files in the browser. **Freeze** holds displayed measurements, not collection or the application. The export contains the collected/live data rather than a screenshot of the frozen view.

## Panel options

`createPerformancePanel` from `jank.js/panel` accepts an options object. Only `shell` and `monitor` are required:

```js
import { createPerformancePanel } from "jank.js/panel";

const panel = createPerformancePanel({
  shell: document.body, // the panel is added to this element
  monitor,
  corner: "top-right", // or "top-left", "bottom-right", "bottom-left"; "none" renders inline
  gpu, // an adapter's source, or a function returning the latest reading
  capture, // frame-linked GPU evidence for recordings; see jank.js/gpu
  loading, // fills the Loading tab, which is hidden without it
  instrumentation, // extra host controls for Capture, such as GPU timing
  comparison, // adds the Compare tab; see below
  onOpenCapture, // replaces the built-in viewer, which loads only when first opened
});
```

The result is `{ refresh(at, force), destroy(), capture, comparison }`. `capture` is the capture controller, for host-side actions such as saving an active recording when your renderer fails. Omit a source and its section stays hidden or reads as unavailable; nothing is estimated in its place.

The panel opens full size and offers mini and one-line views. Automatic capture rules are set in the Capture tab.

## A/B comparison

Pass `comparison` to add the Compare tab. Report two variants and a synchronous way to switch between them. Save your own settings first and put them back in `restore`, which runs however the run ends:

```js
const shadows = getShadows();
const panel = createPerformancePanel({
  shell: document.body,
  monitor,
  comparison: {
    change: "shadows", // the setting under test; other differences are reported as confounds
    variants: {
      A: { label: "Shadows on", settings: { shadows: true, objects: 500 } },
      B: { label: "Shadows off", settings: { shadows: false, objects: 500 } },
    },
    activate: (variant) => setShadows(variant === "A"),
    restore: () => setShadows(shadows),
  },
});
```

Runs alternate AB, BA, AB… over 1–5 pairs, with 0–10 s warm-up and 0.1–30 s measurement per trial. Warm-up is excluded. Capture is locked during a run. Results use medians of per-trial values with equal trial weight and the observed range across pairs: a quick estimate, not a significance test. Verdicts have no minimum effect size, so read the size of the difference shown beside each label. If your host fails, call `panel.comparison.fail(reason)` so the export records why it ended. Finished trials stay exportable, up to the 32 MiB file limit.

See [the Three.js playground](three-playground.md#ab-comparison) for a complete host, and [the performance notes](performance.md) for the runner's overhead.

## Application-defined loading stages

```js
import { createPreparationProfiler } from "jank.js";
const loading = createPreparationProfiler({ stages: ["audio", "sprites"] });
loading.start({ label: "Level one", kind: "fresh-context" });
await loading.measure("audio", () => loadAudio());
await loading.measure("sprites", () => loadSprites());
loading.finish("ready");
const preparation = {
  read: () => loading.snapshot(),
  history: () => loading.history(),
};
```

The configured stage list sets display order. Other non-empty stage names are accepted and shown in first-seen order. The built-in defaults cover general loading work, not terrain/scatter systems. A run's kind is `fresh-context`, `repeat-session`, or `editor`; those labels describe host behavior and do not clear OS or driver caches. Calling `start` seals an unfinished prior run as cancelled. Use `capture()` to bind asynchronous work to the current run so later completions cannot enter its replacement.

## Three.js

The optional adapter uses a structural subset of `renderer.info`, so it does not import or bundle Three.js:

```js
import { registerThreeRenderer } from "jank.js/adapters/three";
const rendering = registerThreeRenderer(monitor, renderer.info);
const start = rendering.begin();
renderer.render(scene, camera);
rendering.end(start);
```

This measures CPU submission and exposes calls, triangles, points, lines, geometry count and texture count. It does not measure GPU time or memory bytes. For multiple render calls per application frame, set `renderer.info.autoReset = false` and call `panel.refresh` first and reset the counters straight after it, so the panel reads the finished frame. The host owns that policy.

## Recording and custom views

`monitor.export()` returns a detached version 2 recording. `serializeRecording(recording)` validates it and enforces a 32 MiB file limit; `parseRecording(text)` validates imports and migrates version 1 without inventing missing metadata. Handle `RecordingFormatError` in your UI. Optional host sections can remain in the downloaded JSON, but the generic parser/viewer intentionally reads only its supported schema.

Use `monitor.snapshot()` for custom live views, and `inspectFrame` and `recordingSummary` for recordings. `monitor.measureRefresh(() => renderView())` measures synchronous custom view work while subtracting nested collection cost. The built-in panel already does this; do not wrap its refresh a second time. See [data model and custom views](data-model.md) for contracts, controls and empty/error states.

```js
monitor.setTargetFps(60);
monitor.armCapture({
  thresholdMs: 40,
  beforeFrames: 120,
  afterFrames: 120,
  cooldownMs: 5000,
});
// Latest completed spike window is retained; a later trigger replaces it.
monitor.disarmCapture(); // An already triggered post-window finishes normally.
```

## DevTools scopes and markers

Enable `monitor.setDevToolsEnabled(true)` or turn on **devtools tracks** in the panel's CAPTURE tab. In Chrome's Performance panel, turn on **Capture settings → Show custom tracks**, start a performance recording, exercise the application, then stop. Named system scopes appear in the jank.js track group; `monitor.event()` adds markers. This uses the documented [User Timing extensibility API](https://developer.chrome.com/docs/devtools/performance/extension), without a browser extension. Other browsers can consume standard User Timing entries but may not render Chrome's custom layout.

jank.js clears only its own entries after emission, preserving the host's timing entries and bounding the page's performance buffer. A `PerformanceObserver` can still receive them. Custom clocks must share the browser performance time origin if DevTools emission is enabled. An injected `DiagnosticTraceSink` is borrowed and is not disposed by the monitor.

## Three.js WebGPU timing (r186 only)

`jank.js/adapters/three-webgpu` has no Three.js runtime dependency. It uses a checked structural contract for the pinned r186 WebGPU backend, including its timestamp-frame query. Other revisions are rejected until verified. Initialization, a real WebGPU backend and the optional `timestamp-query` feature are required. Create the renderer with `trackTimestamp: true` so Three allocates its timestamp resources.

```js
import { REVISION, WebGPURenderer } from "three/webgpu";
import { createThreeWebGpuSource } from "jank.js/adapters/three-webgpu";
const renderer = new WebGPURenderer({ trackTimestamp: true });
await renderer.init();
const gpu = createThreeWebGpuSource(renderer, {
  revision: REVISION,
  onSample: (profile) => monitor.observeGpu(profile),
});
// Pass gpu to createPerformancePanel({ shell, monitor, gpu }).
renderer.setAnimationLoop((at) => {
  const id = monitor.beginFrame(at);
  panel.refresh(at);
  const start = performance.now();
  renderer.render(scene, camera);
  monitor.endFrame(0, performance.now() - start);
  gpu.captureFrame(id);
});
// At shutdown: await renderer.setAnimationLoop(null); gpu.dispose();
// Then destroy the panel, dispose the monitor and release host-owned resources.
```

Use `renderer.setAnimationLoop` so Three advances its native frame ID. The adapter exclusively owns `resolveTimestampsAsync("render")`; do not resolve the same renderer's render timestamps elsewhere. It resolves asynchronously with one request in flight, rejects stale cached results, and links accepted results to the originating diagnostics frame. Disabling or disposing invalidates in-flight results. Disposal restores the original tracking setting when still owned by the adapter, without disposing the renderer.

On a display slower than the budget, this adapter reads as over budget and a Sustained capture rule will fire, because it can't show that it timed all the GPU work. To have readings follow the display's pace, use [frame-linked GPU evidence](gpu-measurements.md) and declare a complete inventory.

The reported value is the **sum of render-pass durations** for one completed renderer frame. Queue span stays null. There are no individual named render-pass or compute timings in this adapter, and timestamps may be delayed or absent. For this intentionally small integration, [local hardware evidence](verification/webgpu.json) does not certify other devices. The current upstream [WebGPURenderer documentation](https://threejs.org/docs/pages/WebGPURenderer.html) describes the renderer; this adapter's pinned source contract remains authoritative for compatibility.

## WebGL2 GPU timing

`jank.js/adapters/webgl2` times named render passes with WebGL2 timer queries (`EXT_disjoint_timer_query_webgl2`) and has no renderer dependency. Chrome exposes the extension. Firefox disabled it as a high-precision timer, and support elsewhere varies, so where it's missing the source reports `unsupported` instead of estimating GPU time from CPU timing.

```js
import { createWebGl2GpuSource } from "jank.js/adapters/webgl2";
const gpu = createWebGl2GpuSource(gl, {
  onSample: (profile) => monitor.observeGpu(profile),
});
// Pass gpu to createPerformancePanel({ shell, monitor, gpu }).
function frame(at) {
  const id = monitor.beginFrame(at);
  panel.refresh(at);
  const start = performance.now();
  gpu.beginPass("shadows");
  drawShadows();
  gpu.endPass();
  gpu.beginPass("scene");
  drawScene();
  gpu.endPass();
  monitor.endFrame(0, performance.now() - start);
  gpu.captureFrame(id);
  requestAnimationFrame(frame);
}
// At shutdown: gpu.dispose(), panel.destroy(), monitor.dispose(). The context stays yours.
```

Passes run one after another: WebGL2 allows one timer query at a time, so beginning a pass while another is open throws, as does capturing a frame with a pass still open. Results arrive a few frames late and are linked to the diagnostics frame that drew them. Results read during a disjoint event, such as a GPU power-state change, are dropped and counted. A lost context reports an error and recovers on the first frame after it is restored. Each frame times at most 32 passes, and at most 64 frames wait for results; anything beyond is counted as omitted or dropped. Disposal deletes only the adapter's queries.

Over-budget readings and capture rules keep using the budget with this adapter, for the same reason as the WebGPU adapter above. `jank.js/gpu` gives the same timer queries with a declared inventory.

A timer query measures elapsed GPU time between its start and end, which can include other work the GPU interleaves, such as the page's compositor. Read pass times as an upper bound on the pass's own cost.

## Appearance

The panel and viewer style themselves inside a Shadow DOM, so there is nothing to import and nothing leaks either way. They use system fonts and follow the design tokens in `src/theme.css`, in dark and light themes. `jank.js/style.css` and `jank.js/font.css` remain as empty stylesheets so existing imports keep working. The `--jank-*` theming tokens from 0.3 are gone.

V1 is designed for desktop widths. The full panel is 360 px wide, and the viewer needs a desktop-sized window.

## Hosting the recording viewer

The panel's **Open** button loads the viewer on demand, from `jank.js/viewer`, as a full-window dialog in your page. To handle that yourself, pass `onOpenCapture`.

The package export `jank.js/viewer.html` is a separate self-contained page: one file, with nothing fetched and nothing uploaded. Copy it anywhere, or open it directly, then choose a recording or comparison file. It reads files up to 32 MiB.
