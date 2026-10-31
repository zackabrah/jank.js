# Offline recording and comparison viewer

Run `pnpm build:viewer` to create `artifacts/jank-viewer.html`. Open that one file in a browser;
it embeds its script, styles and theme, works from `file://`, and makes no network requests.
For development, open `/examples/viewer/` on the workspace Vite server. The basic demo links to
it from **Sources & files**. Imports accept schema-5 recordings and version-1 `jank.js-comparison`
bundles, up to 32 MiB of UTF-8. Files are read locally and never uploaded.

Use **Open recording or comparison**, or drop a file anywhere on the viewer. Invalid, oversized
or unsupported files show their validation error and leave the last valid document, trial and
frame selection intact. A newer import or programmatic load invalidates any older asynchronous
file read; disposal also invalidates reads and releases listeners, resize observation and the
single download URL. There is no animation loop or background polling.

## A/B review

The results table places A, B and the paired difference side by side for CPU/GPU/frame-pacing
median, p95 and over-budget percentages. A prominent notice flags p95 paired ranges that cross
zero as mixed results. The viewer does not declare a winner or statistical significance.
Incomplete or cancelled runs retain their completed trial evidence but have no aggregate result.

Every nested recording is validated before the viewer replaces its current document. Trial
identities must follow the exported AB / BA order without duplicates or gaps; a complete report
must contain every configured pair. Budgets must agree, and a trial cannot extend beyond its
measurement window. Context fields are bounded, labels are rendered as text, and failure paths
identify the nested field (for example `$.trials[1].recording.frames[0].endedAtMs`).

Imported summaries, sample counts and coverage claims are ignored and recomputed from the
recordings using the same analysis as the live comparison panel. The table shows CPU/GPU sample
coverage separately from interval coverage, along with missing/incomplete/sampled-out frames,
loss reasons, finalization text and truncation flags. Finalization text and scene context are
host-reported metadata, not independent verification of the experiment.

Select a **Trial** to inspect it. Scene settings compare the A and B members of that trial's pair,
including drawing-buffer resolution and animation state. Missing fields are explicit; duplicate
setting labels remain separate occurrences. Switching trials resets the selected frame to the
first frame of that trial, so equal frame IDs in different recordings cannot cross-link data.

## Frame inspection

The timeline displays 50, 100 or 200 frames at a time, with range navigation, an editable range
start, exact-budget line and selected-frame outline. Click a bar, use Previous/Next frame, enter a
frame position, or jump to the worst frame. Frame positions are one-based positions within the
selected recording; the inspector separately shows the actual profiler frame ID. Changing range
does not change the selected frame; selecting an out-of-range frame brings its range into view.

CPU rows show scope labels, start/end offsets within the frame and durations, alongside host
update/render totals, scope coverage and interval-union attribution. Scope rows are inclusive;
nested scopes must not be added together. Unattributed time can include waiting and unobserved
work. Unknown host totals and uncollected scopes are not replaced with zero.

GPU observations are selected independently within the frame. Complete interval samples show
busy time, pass sum and elapsed span; incomplete samples retain pass evidence without inventing
totals. Pass rows preserve IDs, invocations and types. Rejected rows show the exact rejection reason
and retained raw timestamp pair. GPU offsets use the sample's GPU clock origin, never CPU time.
Duration-only samples stay labelled as pass sum/elapsed span and do not establish interval coverage.
A frame with no observation explicitly has unknown GPU timing. Events and counters are inspectable
in the final disclosure. Unlinked GPU observations are counted in the recording description.

**Export selected recording** downloads the current trial as a normal Jank recording. This makes
it usable with existing recording tools without manually extracting JSON. It also works for a
single imported recording. The viewer is read-only: it does not edit scene settings or captured
measurements.

## Public API

```ts
import { createViewer, parseComparison } from "jank.js";
import "jank.js/styles.css";

const viewer = createViewer({ container });
const result = viewer.import(fileText); // detects either supported file format
if (!result.ok) console.error(result.problem);

const comparison = parseComparison(fileText);
if (comparison.ok) {
  viewer.loadComparison(comparison.comparison);
  viewer.selectTrial(0);
  viewer.setRange(0, 100); // zero-based start, count 50/100/200
}
// viewer.load(recording), viewer.selectFrame(actualFrameId), viewer.snapshot()
viewer.dispose();
```

`load` and `loadComparison` accept typed data and validate/detach it before replacement. The JSON
import path additionally enforces the encoded-byte limit before parsing. Snapshots are detached.
Repeated disposal and late load/selection calls after disposal do not remount the viewer.

This slice provides local import, A/B review and individual-frame investigation. It does not add
live-window handoff, synchronized A/B playheads, editing, statistical significance estimates or
full parity with the older viewer's advanced timeline interactions. Frame-chart orange bars use
the exact budget; A/B frame-pacing comparisons retain their documented 1 ms or 5% tolerance.
