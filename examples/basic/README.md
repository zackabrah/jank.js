# Basic jank.js demo

Run `pnpm dev:demo` from the rewrite worktree. It opens
`http://127.0.0.1:4187/examples/basic/`.

The scene is 36 rotating cubes and a grid, using the already-pinned Three.js development
dependency. It downloads no models, textures or audio and includes no private demonstration assets.
The texture workloads generate their own deterministic noise locally.
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

Loading uses the public `createLoadingProfiler` runtime. Initial scene construction is the
fresh-context baseline; repeat runs measure a cube reset and two overlapping host waits
(100ms and 200ms minimum, resolved by the host frame loop). These are different workloads,
not a controlled cold/warm benchmark. Cancel seals the current run at its cutoff. The source
retains eight completed sessions. There is no asset download, byte count or cache hit to invent.
The Loading tab shows elapsed union versus combined operation time, baseline bars, cache
observations and session history. See [loading semantics](../../docs/loading.md).

The host-provided trace sink converts profiler-relative times to navigation-relative User
Timing entries. It keeps at most 200 entries and only clears its own names. The dedicated
clear button and profiler restart remove them; unrelated browser/host entries remain intact.

The offline viewer is available through panel handoff. Visibility and temporal diagnostics are available in LIVE. Inspect culling moves the camera
closer; culling and bounded wireframes use real cube AABBs. The temporal view is explicitly a
CPU-projected corner/history preview, not a GPU velocity buffer or TAA. Instance counts remain
unavailable because this scene contains individual meshes. See [integration limits](../../docs/renderer-diagnostics.md).

## Read the integration

- `main.ts`: creates the profiler/channels/panel, owns the single loop, and wires native controls.
- `scene.ts`: owns the Three.js scene, resize observer and GPU resource cleanup. No profiler imports.
- `gpu-source.ts`: selects the real timer or labelled examples and owns adapter replacement/disposal.
- `example-sources.ts`: explicit GPU sample generator and bounded trace sink.
- `loading-example.ts`: real loading runs around scene preparation and overlapping host waits.
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

Open **Quick headroom test**, select **GPU workload**, and choose **Estimate headroom**. The test uses the current
Jank **Target FPS** setting (`1000 / target FPS` milliseconds independently for CPU and GPU).
It measures a baseline, doubles fixed CPU computation batches, doubles the selected offscreen GPU workload, then doubles the number of animated, individually submitted cubes. The last
ramp exercises CPU and GPU together. Each CPU batch updates 4,096 retained values; the GPU probe
runs at the drawing-buffer resolution and writes UV-dependent results to an offscreen target.
Neither workload is a timer-based wait. These workloads are demo-specific, not universal estimates
of how many objects or effects a different game can afford.

Four real GPU workloads are available, all implemented with WebGL2 fragment shaders:

| Workload             | Work increased each step                                                  | Cap |
| -------------------- | ------------------------------------------------------------------------- | --- |
| Shader arithmetic    | Dependent trigonometric iterations per pixel                              | 512 |
| Texture sampling     | Dependent filtered reads from a generated 512×512 texture per pixel       | 512 |
| Volumetric raymarch  | Samples of a procedural density field integrated along each ray           | 256 |
| Diffusion simulation | Five-tap simulation steps alternating between two full-resolution targets | 32  |

Each run tests one selected GPU workload. Arithmetic, sampling and raymarching use one draw;
diffusion uses one draw per simulation step, so its CPU submission cost grows too. Texture
sampling stresses sampling/cache behavior, not a calibrated memory-bandwidth measurement.
Diffusion uses RGBA8 state and is a synthetic workload, not a precision simulation benchmark.
No new animation loop or per-frame readback is introduced. Probe resources are allocated when
the GPU phase first draws, warmed up, reused, then released on Stop/completion or a workload
change. Renderer target, cube face and mip level are restored after each probe.

The selector locks during a run. Reports retain the tested workload and its units even if you
select a different workload afterward. Renderer counters also retain `gpuWorkload` and
`gpuWorkUnits` in recordings. Unsupported timing still skips GPU capacity recommendations.

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

Open **A/B comparison** in the demo controls to configure A and B: object count, deliberate CPU
load, resolution scale and animation state. Then open Jank's **CAPTURE → A/B COMPARISON** to set
warm-up, measurement duration and pairs, and press **Run A/B comparison**. Defaults use three
pairs with one-second warm-up, two-second measurement and 500 ms GPU drain per trial (~21 s).
The order alternates AB / BA. **Stop comparison** restores the scene and retains completed trials.

The runner and results UI now belong to Jank. The demo owns only scene settings, actual drawing
resolution, animation reset/restoration and control locking. It uses actual WebGL2 elapsed timing;
unsupported or incomplete timings remain unknown. Resize/context loss cancel the run. Headroom,
loading and comparison workloads cannot overlap. Completion, cancellation and panel disposal
restore the original scene and GPU mode. Profiler restart creates a fresh comparison controller.

Results include per-trial median/p95, budget overruns, CPU/GPU sample coverage and separate interval
coverage. **Export comparison** downloads one `jank.js-comparison` bundle containing every completed
trial's recording, scene context and comparison summary. The regular archive holds the raw measured
plus drain captures; bundle recordings contain only sealed frames within measurement windows.
See [comparison contracts and measurement limits](../../docs/comparisons.md).


The live panel's **OPEN VIEWER** action opens `/examples/viewer/` and transfers the selected
recording after GPU finalization when a resolver is connected. During manual recording it reads
**STOP & VIEWER**. CAPTURE cards open their own recording without stopping a newer capture.
Blocked popups fall back to a JSON download that can be imported into the standalone viewer.

GPU workload regressions compare real output pixels at two load levels, verify diffusion draw counts, reject out-of-cap loads, restore the borrowed render target, and check resource counts after repeated disposal.
