# Live panel

The rewritten panel mounts through the public package and uses the independent junkui theme
and native tabs. It preserves the compact 360px LINE/FULL and 240px MINI layouts, neutral
palette, square controls, frame graph and CPU/counter readouts. At small viewport sizes the
panel stays within the viewport. LIVE keeps its header, tabs, metrics and graph pinned;
details scroll from CPU SCOPES above the overhead footer. The focusable details region supports
keyboard scrolling and uses a thin, neutral scrollbar with reserved gutter space. LOADING and
CAPTURE scroll independently. CPU scope rows follow channel registration order, keeping their
positions stable as samples and timings change. Counters use one label/value pair per row so
ordinary labels remain readable when the details region scrolls.

Each main section header is a native disclosure: click it, or focus it and press Enter or
Space, to collapse or expand its contents. Sections start expanded and retain their individual
state through refreshes, tab switches and panel-size changes for that mounted panel. Collapsing
a section hides its presentation only; collection, recording and edited settings continue.
The LIVE recording controls remain available even when every detail section is collapsed.

GPU pass rows retain their first-seen order and metadata for the mounted panel. Set
`gpuPassOrder: ["cloud-panorama", "cloud-shadows", "ocean-fft", "scene", "bloom"]`
on `createPanel` to order known pass IDs explicitly; unlisted passes follow in first-seen order.
Rows appear when first observed and stay present when absent from later samples. Missing rows
are dimmed with a dash, an explanatory tooltip and screen-reader text; old timings are never
presented as current or replaced with zero. Rejected timestamps retain their rejection reason.
Pending/disabled/error states keep known rows but mark their timing unavailable.

Repeated passes are identified by stable ID, type and occurrence within that ID/type, rather
than the frame-wide invocation number, which shifts when earlier work is skipped. Displayed
`#1`, `#2`, etc. are those per-pass occurrences; recordings retain their original invocation
numbers. Hosts should give semantically distinct work distinct IDs: indistinguishable repeated
invocations cannot be matched across frames if an earlier invocation of that same ID is skipped.
Duration-only sources use label and occurrence because they supply no IDs.

At most 256 pass rows are remembered. Once full, the panel reports additional current passes
it cannot display and preserves established rows. CLEAR, changing measurement format or
remounting resets the catalogue. Tab changes, freezing and collapsing sections do not.
This is display state only: collection and exported measurements are unchanged.

```ts
import { createPanel, createProfiler } from "jank.js";
import "jank.js/styles.css";

const profiler = createProfiler();
const panel = createPanel({ container: document.body, profiler, mode: "line" });

// In the host's existing loop:
function onFrame(timestamp: number) {
  profiler.beginFrame(timestamp);
  // Host update/render work and channel scopes go here.
  panel.refresh(timestamp);
}
```

No loop is installed by either factory. `beginFrame` seals the preceding interval; the open
frame is excluded from statistics and exports. LINE refreshes at most every 250ms; expanded
views normally refresh every 100ms. Expanded refresh backs off to 250ms when measured average
refresh cost exceeds 0.25ms, returning to 100ms below 0.1ms. Actions redraw immediately.
The footer measures synchronous collection and refresh, excluding deferred paint and GPU work.

`mode` is the fallback when no valid remembered mode exists. Explicit `setMode` updates the
preference. Blocked storage is ignored. `corner` accepts top/bottom and left/right combinations;
the default is top-right. Changing modes rehomes focus only when it would otherwise be hidden.
Invalid mode values throw before changing the view.

## Ownership and files

MINI and FULL hold one independent scope request. LINE or disposal releases only that request;
recording, tracing and other callers retain theirs. Freeze holds a detached presentation
snapshot while recording and collection continue. Closing or disposing the panel leaves the
profiler, archive, borrowed sources and host DOM usable. Repeated disposal and late refreshes
are harmless. Clear explicitly clears profiler observations and captures and resumes display.

CAPTURE uses labelled numeric controls validated by the capture controller. Saved recordings
remain owned by the profiler. `capture.list()` returns small detached summaries with stable
IDs; `capture.read(id)` copies one recording or returns null after eviction/clear. IDs do not
repeat during a profiler's lifetime. The panel reads a saved recording when creating its
thumbnail or exporting it, rather than copying the entire archive at every refresh.

The primary action becomes **STOP & EXPORT** during a manual recording. It stops that capture
and exports its sealed frames, rather than selecting an older saved capture. **STOP REC** remains
available to archive without downloading. Otherwise **EXPORT JSON** selects the latest saved
capture, falling back to recent sealed history. Each saved capture has its own export button;
exporting an older capture does not stop a different active recording.

Connect an interval resolver to finalize pending GPU results through the same action:

```ts
const panel = createPanel({
  container: document.body,
  profiler,
  gpu: gpuSource,
  gpuResolver: gpuSource, // e.g. the Three WebGPU adapter implements both contracts
  exportTimeoutMs: 2000, // default; integer 0–10000 ms
});
```

Export freezes a detached recording before awaiting `finalizeRecording`. The host loop and
collection continue. Duplicate exports are disabled while the resolver settles or reaches its
bounded timeout. The panel then requests one JSON download and shows finalization status,
interval coverage, incomplete/missing/sampled-out frames, known loss reasons, merge omissions
and the recording's truncation flag. The last export notice is also shown beside its saved
capture. The open host frame is excluded; stopping never invents a closing CPU boundary.

No resolver is required for ordinary export. Without one, the panel immediately exports captured
data and explicitly says pending results were not finalized. The WebGL2 adapter currently reports
durations and has no interval resolver; duration-only samples remain in the file but cannot claim
interval coverage. Timeout, cancellation and resolver failure still export available evidence;
unknown timing stays unknown. An error from the download itself is reported separately.

Finalization does not mutate the profiler's original archive. The exported file and **last export**
notice describe the merged copy. A panel keeps at most one finalized copy for retry, and at most
ten per-capture notices. A subsequent export of that same capture starts from the retained merged
copy, preserving late data even if the resolver has since evicted it; existing truncation flags
remain conservative. Replacing/discarding the panel releases this retry state. The archive remains
available independently. CLEAR and disposal invalidate pending downloads; results for an archived
capture that was externally cleared or evicted are also suppressed. Borrowed resolvers are never
disposed by the panel and may finish their own bounded work after invalidation.

Serialization is validated. A failed download retains the capture and retry data. A panel keeps
at most one object URL, revoked on replacement or disposal. “Download requested” describes the
browser handoff; the panel cannot verify that a user accepted a save dialog.

`create-panel.ts` owns lifecycle and presentation state. `live-view.ts` renders measured data;
`capture-view.ts` owns settings and archive DOM; `loading-view.ts` renders an optional source's
current stage summary. Analysis owns numeric semantics and charts own drawing. Host strings
use text nodes; only package-owned static markup uses HTML. The built JavaScript bundles the
public junkui helper, and `jank.js/styles.css` includes junkui's public CSS. Neither shipped
package declares a runtime dependency.

## Verification and remaining work

The initial browser test failed at the absent public factory before implementation. Later
regressions covered LINE's recording indicator and invalid mode mutation. Browser scenarios
exercise sealed data, throttling, scope ownership, mode persistence, keyboard focus, freeze
while recording, validation, exports, unavailable storage, unsafe labels, errors and disposal.
Every visible mode/tab receives an axe check in Chromium, Firefox and WebKit. The package
consumer checks CSS declarations, self-contained CSS, browser-free imports and importing jank
after removing junkui from the isolated consumer's installed packages.

Seven panel screenshots per engine cover desktop LINE/MINI/FULL/CAPTURE, narrow LINE/FULL,
and a short viewport with LIVE details scrolled beneath the fixed summary.
They were visually reviewed on macOS 26 arm64. Only the two variable overhead values are
masked; layout and labels remain visible. These are regression baselines for the new
implementation, not a claim of completed reference parity or remote CI execution.

The [loading runtime](loading.md) and its run/history, cache, cold-baseline and overlap
displays are implemented. The panel borrows the source and freezing copies its display data.
Empty/disconnected sources remain explicit. Visibility/temporal controls remain in slice 7. Optional [GPU timing adapters](gpu-adapters.md)
are implemented. `viewerUrl` enables [viewer handoff](viewer.md#open-directly-from-the-panel).
`visibility` and `temporal` are still draft contract options without panel behavior. GPU observations render explicit
unavailable states; an optional borrowed GPU source provides enable/disable controls. The host
feeds its observations to the profiler, so recording does not depend on an open panel. Adapters
and GPU query ownership remain outside the panel. Tracing requires
a host-supplied trace sink; attempting to enable it without one reports the missing sink.

`pnpm bench` measures collection/capture. `pnpm bench:panel` compares an equally instrumented
host with and without each panel mode using headless Chromium. It reports incremental
synchronous cost **per host frame**, with normal refresh throttling, rather than cost per
redraw. Both paths collect eight scopes and counters. Each mode uses one discarded warmup pair
and fifteen alternating pairs of 5,000 frames, each preceded by 600 warmup frames. Tight loops
include copying, DOM/canvas commands and forced layout, but exclude deferred paint, GPU,
real frame scheduling, loading, archive views and adapters. Batch ranges are not per-frame
tail latency and do not compare against the old implementation.

The [local panel run](verification/panel.json) measured median incremental costs of 0.0085ms
(LINE), 0.0698ms (MINI) and 0.0756ms (FULL) per host frame. See the report for batch ranges and
machine/browser versions, and the [collection rerun](verification/panel-collection.json) for
the separate Node workloads. These are measurement observations, not performance guarantees.

## Capture completeness

Active captures show GPU interval coverage and remaining frame capacity above the full panel's
content. CAPTURE adds reason counts and the shared GPU pool's remaining sample/pass capacity.
Saved cards show their own coverage. Progress uses current collection even while the live
readout is frozen. Missing interval evidence remains explicitly unexplained; deliberately
sampled-out frames are separate from incomplete measurements. See [GPU semantics](gpu-adapters.md).

Stable GPU row verification: 219 unit tests, coverage thresholds, package-consumer checks and
96 focused browser/visual cases passed across Chromium, Firefox and WebKit. Regressions exercise
configured order, first-seen fallback, changing invocation numbers, missing/rejected samples,
restoration, pending state, freezing, clearing, row height and DOM identity. The 256-row bound and
measurement-format reset are covered separately. The required collection benchmark completed;
it excludes panel layout and is not evidence of a UI performance improvement.

## Live visualizer reference parity

The live graph restores the reference's 3px frame spacing, 2px bars, newest-frame highlight,
three-budget minimum scale, dotted guides, worst-frame label and moving marker, numeric budget
label, and frame-aligned event glyphs. The newest visible event has a fixed caption and age.
Labels stay fixed while measured bars glide through the clipped viewport. The animation uses
the compositor, not a second frame loop, and stops on freeze, view changes, hidden documents,
resize, reduced-motion changes and disposal. Colliding event markers favor the newest event;
events in missing frame intervals are not attached to a neighboring frame. Long captions truncate
visually but retain their full text in the accessible graph description and title.

CPU averages now describe the same visible frame window as the graph. Timed channels retain
registration order, with the heaviest named channel emphasized. Dotted CPU and dashed GPU meters
show each measurement relative to the current budget. They are not stacked: inclusive scopes,
pass sums, busy time and elapsed span must not be added together. Values beyond budget retain
their numeric value and tooltip percentage while the fill is bounded to the available width.
Unknown and absent measurements have no fill, never a fabricated zero. GPU row identity,
configured order, missing-observation dimming and timestamp diagnostics are preserved.

The FPS tile again shows high/low one-second rates with the current rate marked between them.
It stays hidden until a complete one-second rate exists. The header restores budget text and
a freeze shortcut; CAPTURE adds 30/60/120 FPS presets beside the validated custom input.
A keyboard-focusable Read summary action announces the displayed frame statistics on request.
Counters restore readable names, source labels, compact numbers and a notice when more than
12 values exist; exact source names and values remain in tooltips and accessible labels.
Package version and the host document's cross-origin isolation state are visible in the footer.

`panel-parity.spec.ts` verifies these specific behaviors rather than relying only on updated
screenshots: annotations and actual bar colors, animation lifecycle, meter fractions and unknown
values, visible-window coverage, FPS range and keyboard controls, and counter overflow. The
reference-parity screenshot includes an event, a slow frame, CPU meters and both measured and
unknown GPU passes. Pure chart-layout tests cover frame geometry, tie-breaking, gaps, marker
collisions and lifecycle glyphs. Existing panel, GPU, accessibility and visual suites remain
required. Offline viewer and loading behavior now have their own verified slices; optional
visibility/temporal functionality remains pending.

The [local parity benchmark](verification/panel-parity.json) measured median incremental
synchronous costs of 0.0094ms (LINE), 0.1385ms (MINI), and 0.2087ms (FULL) per host frame on
an Apple M3 Max with headless Chromium 153. These are synthetic tight-loop measurements with
normal refresh throttling, excluding deferred paint, compositor/GPU execution and real frame
scheduling. They are not a claim of a performance improvement or a controlled comparison with
the earlier panel run. Core coverage, package-consumer checks, the collection benchmark and
cross-browser parity/accessibility/visual tests also passed.

## A/B comparisons

Pass a host-driven `comparison` controller to enable **CAPTURE → A/B COMPARISON**. It provides
warm-up/measurement/pair controls, cancellation, per-trial coverage, median/p95/budget comparisons
and one export containing all completed trial recordings. See [comparison integration and limits](comparisons.md).
The section stays hidden when no comparison host is connected. Closing the panel cancels an active
run and restores the scene without disposing the borrowed controller.
