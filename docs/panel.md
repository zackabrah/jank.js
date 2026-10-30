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

EXPORT JSON selects the latest saved capture, falling back to recent sealed history when no
capture exists. Each saved capture also has its own export button. Serialization is validated;
download failures display a readable error without changing stored data. A panel retains at
most one object URL, revoked on replacement or disposal.

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

The loading runtime and its full run/history, cache and overlap displays remain in slice 7.
The current loading tab can display an injected source's stage summary or an explicit empty
state. Visibility/temporal controls remain in slice 7. Optional [GPU timing adapters](gpu-adapters.md)
are implemented. `viewerUrl`,
`visibility` and `temporal` are still draft contract options without panel behavior; viewer
opening/handoff arrives with the actual offline viewer. GPU observations render explicit
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
