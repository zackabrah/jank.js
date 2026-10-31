# Usage guide · jank.js 0.2.1-rewrite.4

Jank helps inspect frame pacing, CPU work, asynchronous GPU observations and recorded A/B
experiments. It runs locally. Host integration is described in [INTEGRATION.md](INTEGRATION.md).
This is a private preview: recording schema 5, comparison format version 1.

## Open the bundle

- Open `jank-ui-library.html` in a browser to explore the controls, theme, animation and panel
  modes. Its sample stream and diagnostic sources are explicitly **simulated**.
- Open `jank-viewer.html` to inspect exported files offline. Choose **Open recording or
  comparison**, or drop a file onto the page. The bundle's `samples/example-recording.json`
  provides a synthetic frame spike to explore; it is not a device benchmark.
- Install `packages/jank.js-0.2.1-rewrite.4.tgz` into a host application to measure real work.
  `junkui` is independent and optional; Jank already bundles the UI code it needs.

The HTML files include their scripts and styles and require no server or network access.
They do not instrument other open pages. The viewer begins empty until you import a file.
The UI library is a showcase, not a CPU/GPU benchmark or the live scene stress-test demo.

## Read the live panel

Use FULL for detailed inspection, MINI for a compact graph or LINE for a single-line summary.
Expand/collapse controls are in the panel header. Each main detail section also collapses
independently without changing the host work. The graph area scrolls separately from its
summary. Set the target FPS budget to match your application; 60 FPS is approximately 16.7 ms.

FPS, average, p95 and worst describe the retained frame window. Orange cues identify budget
misses. CPU scope meters show measured channel durations, GPU rows show asynchronous results,
and counters show values supplied by the host. Registered work rows retain their order;
unobserved work is dimmed or shown as unavailable. Missing measurements are not zero.

Render submission scopes measure CPU time. GPU busy time, pass sums and elapsed span are
separate quantities; overlapping passes make them differ. Unattributed frame time includes
waiting and idle time outside observed scopes, not proven hidden CPU work. Scope durations
can overlap. A likely-cause cue is a heuristic to investigate, not a causal conclusion.

**FREEZE** pauses the display while the application and collection continue. **RESUME** shows
current observations again. **CLEAR** removes frame history and captures; export data you need
first. It does not clear a host-owned loading source. Source controls are unavailable when
that integration is absent, and disabled while its display is frozen.

## Capture an investigation

1. Choose a stable scene, resolution, animation state and budget. Let initialization settle.
2. Click **REC**, exercise the workload, then stop recording or use **EXPORT JSON** to stop
   and export through one action. The CAPTURE tab retains completed recordings.
3. Review recorded frames, remaining capacity and GPU coverage. With a connected resolver,
   export waits for pending GPU results up to its configured timeout and reports the outcome.
4. Open the exported file in `jank-viewer.html`. Keep incomplete captures when useful, but
   treat their coverage and missing data as part of the result.

The recent history holds 600 frames; manual capture holds up to 6,000 frames; ten completed
captures are retained. Old captures can be evicted. The last open frame is not sealed until
the next host frame boundary and is excluded from export. Limits are counts, not guaranteed
recording durations. This build does not promise unlimited streaming capture.

Automatic capture uses labelled threshold, before/after-frame and cooldown controls. Arm it
to retain context around a slow frame; disarming stops new triggers while an active after-frame
window finishes. Manual recording disarms automatic capture.

Coverage distinguishes observed intervals, missing/partial results, intentional sampling and
omissions. Rejected timestamp diagnostics preserve their reason and raw evidence when supplied
by the adapter. Invalid/unexpected WebGPU timestamps do not automatically mean Jank is faulty.
An unsupported timer, query pressure or readback timeout must not be interpreted as fast GPU work.

## Loading and renderer diagnostics

The LOADING tab shows current runs, cold-baseline comparisons, stage bars, cache observations,
bytes and recent sessions. Open stage details for combined time, overlap, failures and
cancellations. Wall time includes I/O and waiting. A host-labelled fresh-context run is not
proof that every system cache was cold. Loading observations are separate from frame exports.

When connected, VISIBILITY shows tested/visible/culled work and debug bounds controls.
INSTANCES shows hierarchy/preparation/cache data plus delayed candidates and culling results;
check the sample age. TEMPORAL routes rigid-object history and final/motion/history views to
the host. These controls only affect rendering if the host integration implements them.
The library uses simulated sources. The development scene's temporal preview is CPU-projected
history, not a GPU velocity buffer or TAA implementation.

## Navigate the offline viewer

Select a frame by clicking its timeline. Use the session overview to move through the full
recording and drag the visible range. Zoom with the controls or wheel. VIEW exposes precise
range/navigation controls; FRAME DETAILS holds timings and CPU/GPU evidence. RECORDING &
COVERAGE explains losses and metadata. Capture navigation jumps to retained events of interest.
Use frame copy/export controls to share exact evidence.

Arrow keys move between frames; Shift+arrow moves ten; Home/End select recording endpoints.
Bracket keys cycle captures. Shortcuts do not take over editable fields. Invalid or unsupported
imports preserve the current recording and show an error. Files are read locally, never uploaded.
The limit is 32 MiB of UTF-8 per imported recording/comparison. Older schemas are rejected.

## Compare A and B

A connected comparison host supplies two configurations. Choose warm-up, measurement duration
and repeated pairs; the controller alternates AB/BA order and records context. Keep scene,
resolution, animation and other machine load comparable. Export the comparison bundle.

In the viewer, A is cyan/solid and B is violet/dashed. Both overlay shared scales and elapsed
time; each can be hidden independently. Select a trial/pair and inspect matched CPU/GPU rows,
scene settings, coverage, median/p95 and over-budget differences. Missing evidence stays unknown.
A paired range crossing zero indicates mixed results; the viewer does not declare significance
or a universal winner. Time alignment alone does not ensure identical animation state.

## Troubleshooting

| Symptom                              | Check                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| No panel or stale display            | Host calls `beginFrame` and `panel.refresh` from its own loop; CSS is imported.              |
| No CPU scopes in LINE                | Hold an explicit scope request, or use FULL/MINI; see the integration guide.                 |
| No GPU values                        | Adapter support/enabled state, pass bracketing, timestamp feature and pending-result status. |
| Renderer counters seem shifted       | Counters are polled at the frame boundary; inspect the host's reset policy.                  |
| Missing visibility/temporal sections | Those optional sources must be connected by the host.                                        |
| Capture is partial                   | Inspect capacity, omitted passes, sample age, rejection reasons and finalization notice.     |
| Viewer handoff downloads instead     | Direct transfer requires a same-origin hosted viewer; import locally otherwise.              |
| Measurements change between runs     | Check warm-up, animation, resolution, background load, thermal state and coverage.           |

Synchronous collection/refresh overhead excludes deferred paint and GPU work. Use real application
runs when deciding how much budget remains; the showcase is not evidence of available headroom.
