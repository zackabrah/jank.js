# Integration and adapters

## Ownership

Use one diagnostics monitor and one panel per container in the current document. The panel (jank.js) is a guest: it is `position: fixed` in a corner of the viewport, overlays the page without resizing its renderer, captures no keyboard shortcuts unless focused and never prevents default on host events. Creating a second panel in the same container throws; dispose the first before replacing it. Different containers can have independent monitors.

The host owns requestAnimationFrame, renderer settings, clocks and GPU resources. jank.js never creates a second animation loop. Call `monitor.beginFrame(at)` at the start of an application frame, `monitor.endFrame(updateMs, renderMs)` after CPU submission, and `tray.refresh(at)` from the same loop. The next `beginFrame` seals the preceding interval, so the final pending frame is deliberately excluded from an immediate export. Legacy `frame(at, interval, update, render)` still collects pacing, with exact scope attribution unavailable; do not mix the two APIs. All arguments are milliseconds on the same monotonic clock as `performance.now()` / the requestAnimationFrame timestamp. Supplying a custom diagnostics clock requires frame timestamps from that same clock.

`tray.dispose()` removes the UI and listeners and is safe to repeat. A late `refresh` is ignored. It does not dispose the host monitor, stop its recording, change renderer settings, or release host resources. Dispose channels and the monitor when their owner ends. GPU toggles and debug settings stay under the host's ownership.

Importing the library is safe without a DOM; creating the tray or bounds overlay requires a browser. Shadow-root and cross-document/iframe mounting are not supported by this initial release.

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

IDs must be unique within a monitor. Timed systems appear as CPU rows in registration order; every system's values appear under COUNTERS. A system that only supplies values and is never timed has no CPU row. Readers return number, string, boolean or null values. Providers should be cheap and supply only data the host intends to display/export. Detailed channel timing activates while expanded, recording, armed for spike capture, or emitting DevTools tracks. Disabled `begin()` returns a sentinel which `end()` safely ignores.

Recordings can contain application-provided labels and values. There is no network transport; EXPORT JSON downloads locally and OPEN IN VIEWER only posts to a window the panel opened. FREEZE freezes displayed measurements, not collection or the application. The export contains the collected/live data rather than a screenshot of the frozen view.

## Optional sources

`createPerformanceTray` accepts an options object:

```js
const tray = createPerformanceTray({
  shell,
  monitor,
  gpu, // PerformanceGpuSource
  culling, // PerformanceCullingSource
  temporal, // PerformanceTemporalSource
  preparation, // PerformancePreparationSource
  mode: "line", // "line" (default), "mini" or "full"
  corner: "top-right", // or "top-left", "bottom-right", "bottom-left"
  viewerUrl: "/viewer/", // optional: where OPEN IN VIEWER sends recordings
  capture: { thresholdMs: 33.3, beforeFrames: 120, afterFrames: 60 },
});
```

Omit unsupported sources and their sections stay hidden. These are extension interfaces, not automatic instrumentation for every renderer. Public types are exported from `jank.js`.

`mode` is the size the panel opens at the first time. After that it reopens at the size the user last chose, remembered per origin in `localStorage` under `jank.js:panel-mode`. The panel collects CPU scopes while it is MINI or FULL (`setExpanded(true)`), not while it is one line.

`viewerUrl` names a recording viewer page the application hosts, such as the built `viewer/` page. **OPEN IN VIEWER** opens it with `window.open`; the viewer posts `{ type: "jank.js:viewer-ready" }` to its opener, and the panel replies to that window only with `{ type: "jank.js:recording", name, json }`. The viewer validates the JSON as it would a file. Without `viewerUrl` those buttons are disabled and **EXPORT JSON** remains.

`capture` sets the window AUTO CAPTURE arms the monitor with; unset values use the monitor's defaults (threshold twice the budget, 120 frames before and after, 5 s cooldown). The user can change them in the CAPTURE tab. The panel keeps up to ten completed automatic captures in memory; the monitor itself holds only the latest.

| Source           | Read contract                                      | Host controls                                                  |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| GPU              | `read(): GpuProfile \| undefined`                  | `setEnabled(boolean)`                                          |
| Visibility       | `read(): CullingDiagnostics \| undefined`          | `setEnabled`, `setDebugBounds`, optional `setInstancesEnabled` |
| Temporal history | `read(): TemporalDiagnostics \| undefined`         | `setEnabled`, `setDebugView`                                   |
| Loading          | `read(): PreparationSnapshot \| null`, `history()` | Host owns recording scopes                                     |

Return detached snapshots, especially loading snapshots which may be retained while frozen. Readers can return unavailable states during initialization. Reader exceptions are contained; setter errors remain the host's responsibility.

A GPU source may carry an optional `label` (for example `"three.js webgpu"`), which the panel shows as the source's name; it defaults to `renderer`. GPU providers must use asynchronous timestamps, preserve null for unavailable measurements, and identify samples by renderer frame number. `currentFrame` is the renderer's current frame, `sampleFrame` is the frame that was timed, and `sampleAgeFrames` describes its age. Samples may arrive late. jank.js deduplicates them. Supply `diagnosticFrame` from `beginFrame` for exact inspector correlation and capture-window filtering. Without that link, renderer frame numbers are never assumed to match CPU frame IDs; such samples remain unlinked. Unsupported timestamp queries must be reported as unsupported, never replaced with CPU durations. See `GpuProfile` for ready, pending, disabled, unsupported and error states.

Visibility's main/shadow/reflection counts describe the views supplied by the host. The optional `createCullingBoundsOverlay(container)` is refreshed explicitly with a visibility snapshot. Its projector expects a column-major world-to-clip matrix with **WebGPU depth 0 ≤ z ≤ w**. Convert a WebGL projection before using that overlay. Debug drawing is bounded to 128 boxes and owns no GPU resources.

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

This measures CPU submission and exposes calls, triangles, points, lines, geometry count and texture count. It does not measure GPU time or memory bytes. For multiple render calls per application frame, set `renderer.info.autoReset = false` and reset the counters once at the start of your frame; call `tray.refresh` after all submissions. The host owns that policy.

## Recording and custom views

`monitor.export()` returns a detached version 2 recording. `serializeRecording(recording)` validates it and enforces a 32 MiB file limit; `parseRecording(text)` validates imports and migrates version 1 without inventing missing metadata. Handle `RecordingFormatError` in your UI. Optional host sections can remain in the downloaded JSON, but the generic parser/viewer intentionally reads only its supported schema.

Use `createRecordingViewModel()` for new viewer designs, and `monitor.snapshot()` for live panels. `monitor.measureRefresh(() => renderView())` measures synchronous custom view work while subtracting nested collection cost. The built-in panel already does this; do not wrap its refresh a second time. See [data model and custom views](data-model.md) for contracts, controls and empty/error states.

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
// Pass gpu to createPerformanceTray({ shell, monitor, gpu }).
renderer.setAnimationLoop((at) => {
  const id = monitor.beginFrame(at);
  const start = performance.now();
  renderer.render(scene, camera);
  monitor.endFrame(0, performance.now() - start);
  gpu.captureFrame(id);
  tray.refresh(at);
});
// At shutdown: await renderer.setAnimationLoop(null); gpu.dispose();
// Then dispose the tray, monitor and host-owned renderer/resources.
```

Use `renderer.setAnimationLoop` so Three advances its native frame ID. The adapter exclusively owns `resolveTimestampsAsync("render")`; do not resolve the same renderer's render timestamps elsewhere. It resolves asynchronously with one request in flight, rejects stale cached results, and links accepted results to the originating diagnostics frame. Disabling or disposing invalidates in-flight results. Disposal restores the original tracking setting when still owned by the adapter, without disposing the renderer.

The reported value is the **sum of render-pass durations** for one completed renderer frame. Queue span stays null. There are no individual named render-pass or compute timings in this adapter, and timestamps may be delayed or absent. For this intentionally small integration, [local hardware evidence](verification/webgpu.json) does not certify other devices. The current upstream [WebGPURenderer documentation](https://threejs.org/docs/pages/WebGPURenderer.html) describes the renderer; this adapter's pinned source contract remains authoritative for compatibility.

## Appearance and theming

Import `jank.js/style.css` for the panel. It is self-contained: every rule is scoped under `.jank` and sets the properties it needs (font, colours, box sizing, line height), so the host's CSS does not restyle the panel and the panel does not leak into the host. Import `jank.js/font.css` as well to load IBM Plex Mono (400, 500 and 600, Latin subset, about 45 KB); without it the panel uses the platform monospace.

The jank.js tokens are the theming surface. They are defined on `.jank` in `src/performance/tokens.css`, which `style.css` includes. Override any of them with a rule on `.jank` that loads after the stylesheet:

| Token                                                                       | Default                                | Used for                                                    |
| --------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `--jank-ink`                                                                | `#0a0a0a`                              | Panel background                                            |
| `--jank-line`, `--jank-line-strong`, `--jank-control`                       | greys                                  | Section rules, the panel outline and inputs, button borders |
| `--jank-graph`, `--jank-faint`, `--jank-dim`, `--jank-muted`, `--jank-soft` | greys                                  | Bars, leaders, labels, secondary values, ghost series       |
| `--jank-text`, `--jank-bright`                                              | `#e8e8e8`, `#fff`                      | Values, inverted controls, the newest frame                 |
| `--jank-miss`                                                               | `#f26032`                              | Over budget, and nothing else                               |
| `--jank-row`                                                                | `#161616`                              | The one highlighted row                                     |
| `--jank-font`                                                               | IBM Plex Mono, then platform monospace | The only typeface                                           |
| `--jank-panel-w`, `--jank-mini-w`, `--jank-line-h`, `--jank-inset`          | 360, 240, 28, 20 px                    | Sizes and the distance from the docked corner               |

Text sizes, tracking, padding and control heights have tokens too; see `tokens.css`. Set `--jank-z-index` on the container to change the panel's stacking order (default 30). Dark is the only theme: the panel is a measuring instrument, and orange keeps one meaning.

An engine or editor integration can map its native renderer diagnostics to these public types and keep its own layout around the panel in its own CSS.

## Hosting the recording viewer

The package export `jank.js/viewer.html` is a self-contained offline viewer. Copy it to a same-origin static route such as `/viewer/index.html`, and set `viewerUrl: "/viewer/"` when creating the panel. The panel hands the recording to that window locally; no upload service is required. Serve it from your application’s own base path when hosted below a directory prefix.
