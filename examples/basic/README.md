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
3. On **LIVE**, try REC, FREEZE, RESUME and **STOP & EXPORT**. One action stops the manual
   recording and downloads it. **STOP REC** archives without downloading; **EXPORT JSON** exports
   saved/recent data. Freeze affects presentation, not collection. CLEAR clears the profiler's
   history and capture archive. The WebGL2 demo has no interval resolver, so its export notice
   explicitly reports that pending GPU results were not finalized.
4. Edit the event label and add a marker. Events appear on LIVE and in recordings.
5. Open **Sources & files**. Exercise GPU states, run the loading example,
   enable TRACE in CAPTURE, or deliberately fail and recover the counter provider.
6. Validate an exported JSON file using the labelled file picker. The summary shows schema,
   frame, counter and GPU counts. Invalid input keeps the last successful summary; nothing uploads.
7. Under **Panel controls**, switch sizes, request scopes independently, detach
   and reattach the panel, or stop and recreate the profiler. The scene keeps running. A new
   profiler starts with an empty archive; merely replacing the panel preserves it.

The panel itself provides frame budget, threshold, before/after and cooldown controls, saved
capture thumbnails, exports, scope/tracing status and refresh/collection overhead. The scene
fills the viewport, with compact controls at bottom-left and the profiler at top-right. On
narrow screens the controls sit below the profiler; each scrolls independently over the scene.

## Real measurements and example data

Frame boundaries come from the browser's real `requestAnimationFrame` timestamps. The profiler
uses `performance.now()` for scopes. `animation` contains the nested `deliberate CPU work`
scope; those inclusive numbers must not be added together. `render submit` measures the CPU
call to Three.js, not GPU execution. Counters come from the active scene and `renderer.info`.
Actual results vary by browser, hardware, visibility and other workloads. No fixed FPS is promised.

**GPU timing** defaults to the real WebGL2 timer around scene rendering. Results arrive
asynchronously and are correlated with their original profiler frame. Browsers without the
timer extension report unsupported timing. Stopping the profiler releases its queries while
the scene continues; restarting creates a new adapter for the new profiler.

The same selector offers explicitly **SIMULATED** pass labels and pending, unsupported and
error examples. Simulated measurements are opt-in and retain their labels in exported files.
They delay correlation by two host frames. Missing real timings are never replaced with these
examples or invented zeros. See [GPU measurement limits](../../docs/gpu-adapters.md).

Loading is a small **host-provided source**, not the pending loading-profiler implementation.
It measures a synchronous cube reset and an elapsed wait of at least 200ms. There is no asset
download, byte count or cache hit to invent. The source retains ten completed run summaries.

The host-provided trace sink converts profiler-relative times to navigation-relative User
Timing entries. It keeps at most 200 entries and only clears its own names. The dedicated
clear button and profiler restart remove them; unrelated browser/host entries remain intact.

The offline viewer and visibility/temporal integrations remain
pending and are not represented by fake controls here.

## Read the integration

- `main.ts`: creates the profiler/channels/panel, owns the single loop, and wires native controls.
- `scene.ts`: owns the Three.js scene, resize observer and GPU resource cleanup. No profiler imports.
- `gpu-source.ts`: selects the real timer or labelled examples and owns adapter replacement/disposal.
- `example-sources.ts`: explicit GPU sample generator, host loading source and bounded trace sink.
- `recording-file.ts`: file reading, validation and stale-result protection.

Imports use the profiler's public source entry while developing this worktree. An installed
consumer uses `import { createProfiler, createPanel } from "jank.js"` and
`import "jank.js/styles.css"` instead. Three.js belongs to this host example, not jank's
runtime dependencies. Removing the panel releases only its scope request; disposing the
profiler leaves host rendering intact. Leaving the page cancels the host loop, detaches
listeners and releases the scene's renderer, geometry, materials and observer.

## Verification

The initial browser test failed before the demo existed. Six integration scenarios run in
Chromium, Firefox and WebKit: actual scene/counter updates, deliberate-hitch capture and
validated download, panel/profiler lifecycle, optional sources and file validation, and axe
checks on desktop and narrow viewports. These exercise real browser rendering, with no mocked
profiler or fabricated CPU/frame results. The sixth covers the default real timer and profiler
restart. Core coverage and package-consumer checks remain
separate from the demo's browser tests.

The real renderer counter labels exposed a panel layout bug: short numeric values could wrap
onto multiple lines. The demo regression checks their rendered height, and the panel now keeps
space for the value while allowing the label to wrap.

## Quick headroom estimate

Open **Quick headroom test** and choose **Estimate headroom**. The test uses the current
Jank **Target FPS** setting (`1000 / target FPS` milliseconds independently for CPU and GPU).
It measures a baseline, doubles fixed CPU computation batches, doubles an offscreen GPU shader's
iteration count, then doubles the number of animated, individually submitted cubes. The last
ramp exercises CPU and GPU together. Each CPU batch updates 4,096 retained values; the GPU probe
runs at the drawing-buffer resolution and writes UV-dependent results to an offscreen target.
Neither workload is a timer-based wait. These workloads are demo-specific, not universal estimates
of how many objects or effects a different game can afford.

A step warms up for 600ms, measures for 1,000ms, then allows 300ms at baseline load for pending
GPU queries. Two halves of each measurement window must each contain at least 12 frames.
A CPU, GPU or frame-pacing budget breach must occur in both halves' p95 measurements to establish
a failing step. A breach in just one half stops that ramp as unstable. Presentation timing allows
1ms or 5% tolerance, whichever is larger; CPU and GPU budget comparisons have no such tolerance.
GPU results use the exact measured frame IDs, ignore duplicate replies, and require 80% valid
coverage in each half. Missing timing stays unknown. If baseline GPU timing is unavailable, the
GPU probe is skipped; CPU and scene observations remain explicitly GPU-unverified.

The report gives baseline remaining CPU/GPU milliseconds separately, the last measured passing
level, the next failing or inconclusive level, and the largest measured level with 20% spare
CPU and GPU time. CPU means update plus render submission, excluding browser paint and profiler
panel refresh. GPU means the timed scene and probe. These times overlap and must not be added.
A load cap reports a lower bound; an unstable or insufficient window never establishes a ceiling.
One short run cannot characterize sustained thermal behavior or other workloads.

The run stops after approximately 60 seconds. Each ramp has a workload cap and stops after
three severe frames (CPU over 100ms or frame interval over 250ms). The time limit is checked between
frames, so a slow in-flight frame can delay it. **Stop estimate** restores the original object
count and GPU mode, releases the probe and extra scene objects, and retains completed results.
Motion runs and manual CPU stalls are ignored during the estimate, then their settings resume.
Viewport, target-budget, GPU-source/context or visibility changes invalidate and cancel the run.
The host retains a single animation loop. Nothing is installed into either shipped package.

Headroom regression tests cover sustained budget decisions, sparse and delayed GPU results,
conservative recommendations, cancellation and bounded execution. Browser checks exercise
budget changes, Stop/resize restoration, unavailable GPU timing, completion, real additional
GPU draw work, restored counters, and desktop/narrow accessibility in all three browsers.

## Repeatable A/B comparisons

Open **A/B comparison**. Configure A and B with an object count, optional deliberate CPU stall,
resolution scale, and animation state. Choose warm-up and measurement durations and 2–6 pairs,
then **Run A/B comparison**. Defaults run three pairs in approximately 21 seconds. The order
alternates A/B, B/A, A/B to expose some effects of changing machine conditions. Each trial resets
animation time to zero before warming up; frozen trials use the same initial poses. Resolution
scale multiplies the demo's pixel ratio (device ratio capped at 2), without changing the CSS viewport.

Each trial warms up for 0.5–10 seconds, measures for 1–10 seconds, then allows 500ms for GPU
readbacks. Only frames whose two host boundaries fall within the measurement window contribute.
CPU measurements cover update and render submission, including any requested deliberate stall;
GPU measurements use only the actual WebGL2 timer around the scene. Late replies are matched by
profiler frame ID and deduplicated. Readbacks arriving after the drain do not alter completed
trials. No simulated timing is substituted when timer queries are unsupported or missing.

The report shows per-trial p95 CPU/GPU/frame times, sample counts, GPU coverage, and the percentage
over Jank's current budget. CPU/GPU comparisons use the exact budget; frame pacing allows 1ms or
5% tolerance because presentation intervals are quantized. Each metric needs 20 valid samples and complete frame intervals covering at least 80% of the
requested measurement duration. Window coverage is reported; a long frame crossing the end cannot
leave only fast frames and silently produce a comparison.
GPU also requires at least 80% coverage in **every** trial before an aggregate comparison is shown.

The summary gives A and B medians and ranges of trial p95 values, and the median/range of paired
B-minus-A differences. Trials have equal weight rather than pooling all frames. Negative differences
mean lower time. A range crossing zero means mixed observations. These are descriptive results,
not statistical significance, universal headroom or a guarantee under sustained thermal load.
CPU and GPU overlap and must not be added. CPU excludes panel refresh/browser paint; frame pacing
includes the whole host loop. Keep the same panel instrumentation and minimize other machine work.

**Export comparison** downloads a separate `jank-demo-comparison` JSON report, not a Jank recording.
It includes the full A/B configuration, warm-up/measurement schedule, target budget, ordered trial
results, GPU coverage, actual drawing-buffer dimensions per trial, CSS viewport/device pixel ratio,
animation policy, browser identity, panel mode, scope/tracing state and measurement limits. The
recording file picker deliberately does not treat this report as a frame recording.

Scene and panel controls are disabled during comparison; **Stop comparison** remains available.
Existing recordings must first be stopped or disarmed and their archive is preserved. Headroom,
loading and comparison runs cannot overlap. Completion or cancellation restores the original scene
count, resolution, animation time and GPU mode; the user's CPU/motion controls are left intact.
Hiding the tab, changing viewport/device ratio or budget, losing the GPU context, or changing the
GPU source cancels the run. Only completed trials are retained, and a cancelled run has no aggregate
comparison. Per-trial storage is capped at 2,048 frames. Three consecutive CPU frames above 100ms
stop the run; a wall-clock deadline allows the planned duration plus 20 seconds, checked between
host frames. An in-flight blocking frame can delay cancellation.

`comparison-run.ts` owns bounded windows and paired statistics; `comparison.ts` owns controls,
metadata, export and restoration. The main demo loop remains the only animation scheduler.
Deterministic tests cover boundaries, delayed/duplicate/missing GPU timing, sparse windows,
paired variation, caps and cancellation. Browser cases in all three engines cover completed runs,
exports, restoration, unavailable GPU timing, existing captures, resize, and accessibility.
