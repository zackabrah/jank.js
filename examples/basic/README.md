# Basic jank.js demo

Run `pnpm dev:demo` from the rewrite worktree. It opens
`http://127.0.0.1:4187/examples/basic/`.

The scene is 36 rotating cubes and a grid, using the already-pinned Three.js development
dependency. It has no models, textures, audio, remote requests or private demonstration assets.
Increasing the object count deliberately increases animation and draw-submission work; the
cubes share geometry and two materials. This example is outside both shipped packages.

## Try it

1. Change **Objects** or **Extra CPU per frame**. Watch CPU scopes and renderer counters.
   Pause motion to freeze the cubes while the host loop and profiler keep running.
2. Press **Capture next hitch**, then open the panel's **CAPTURE** tab. This arms a 50ms
   threshold with 30 preceding / 10 following frames, then blocks the next frame for 80ms.
   Export the saved capture. Automatic capture remains armed after its five-second cooldown;
   use DISARM to stop future triggers. A window can contain fewer preceding frames near startup.
3. On **LIVE**, try REC, FREEZE, RESUME, STOP REC and EXPORT JSON. Freeze affects presentation,
   not collection. CLEAR clears the profiler's history and capture archive.
4. Edit the event label and add a marker. Events appear on LIVE and in recordings.
5. Open **Optional sources and recording files**. Exercise GPU states, run the loading example,
   enable TRACE in CAPTURE, or deliberately fail and recover the counter provider.
6. Validate an exported JSON file using the labelled file picker. The summary shows schema,
   frame, counter and GPU counts. Invalid input keeps the last successful summary; nothing uploads.
7. Under **Panel and profiler lifecycle**, switch sizes, request scopes independently, detach
   and reattach the panel, or stop and recreate the profiler. The scene keeps running. A new
   profiler starts with an empty archive; merely replacing the panel preserves it.

The panel itself provides frame budget, threshold, before/after and cooldown controls, saved
capture thumbnails, exports, scope/tracing status and refresh/collection overhead. At widths
below 900px the example docks the panel below its controls to keep both reachable.

## Real measurements and example data

Frame boundaries come from the browser's real `requestAnimationFrame` timestamps. The profiler
uses `performance.now()` for scopes. `animation` contains the nested `deliberate CPU work`
scope; those inclusive numbers must not be added together. `render submit` measures the CPU
call to Three.js, not GPU execution. Counters come from the active scene and `renderer.info`.
Actual results vary by browser, hardware, visibility and other workloads. No fixed FPS is promised.

GPU samples are **synthetic**, disabled by default. Their pass labels and recording application
metadata explicitly identify them. The example delays correlation by two host frames to show
the existing asynchronous GPU readout; it performs no GPU timer queries. Pending, unsupported
and error states are selectable without pretending that missing data is zero.

Loading is a small **host-provided source**, not the pending loading-profiler implementation.
It measures a synchronous cube reset and an elapsed wait of at least 200ms. There is no asset
download, byte count or cache hit to invent. The source retains ten completed run summaries.

The host-provided trace sink converts profiler-relative times to navigation-relative User
Timing entries. It keeps at most 200 entries and only clears its own names. The dedicated
clear button and profiler restart remove them; unrelated browser/host entries remain intact.

The offline viewer, renderer timing adapters and visibility/temporal integrations remain
pending and are not represented by fake controls here.

## Read the integration

- `main.ts`: creates the profiler/channels/panel, owns the single loop, and wires native controls.
- `scene.ts`: owns the Three.js scene, resize observer and GPU resource cleanup. No profiler imports.
- `example-sources.ts`: explicit GPU sample generator, host loading source and bounded trace sink.
- `recording-file.ts`: file reading, validation and stale-result protection.

Imports use the profiler's public source entry while developing this worktree. An installed
consumer uses `import { createProfiler, createPanel } from "jank.js"` and
`import "jank.js/styles.css"` instead. Three.js belongs to this host example, not jank's
runtime dependencies. Removing the panel releases only its scope request; disposing the
profiler leaves host rendering intact. Leaving the page cancels the host loop, detaches
listeners and releases the scene's renderer, geometry, materials and observer.

## Verification

The initial browser test failed before the demo existed. Five integration scenarios run in
Chromium, Firefox and WebKit: actual scene/counter updates, deliberate-hitch capture and
validated download, panel/profiler lifecycle, optional sources and file validation, and axe
checks on desktop and narrow viewports. These exercise real browser rendering, with no mocked
profiler or fabricated CPU/frame results. Core coverage and package-consumer checks remain
separate from the demo's browser tests.

The real renderer counter labels exposed a panel layout bug: short numeric values could wrap
onto multiple lines. The demo regression checks their rendered height, and the panel now keeps
space for the value while allowing the label to wrap.
