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

## Layout and controls

The desktop shell follows the original viewer: a compact toolbar and environment line, a full-session
overview, timeline lanes on the left and a 440 px inspector on the right. The timeline and inspector
scroll independently. Below 1100 px, the inspector stacks beneath the graphs. Click the session
overview to select a time and bring its window into view.

**VIEW** holds zoom, range and scroll controls. **FRAME DETAILS** holds exact CPU/GPU evidence and
frame-position controls; **COMPARISON DETAILS** holds aggregate results, trial coverage, scene settings
and paired diagnostic tables. **RECORDING & COVERAGE** retains capture losses and metadata.
The compact inspector keeps selected frame timing and CPU/GPU summaries visible.

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
setting labels remain separate occurrences. Switching trials preserves the comparison elapsed time and resolves a frame in the new recording,
so equal frame IDs in different recordings cannot cross-link data.

## Synchronized A/B inspection

The selected trial chooses its A/B pair. A and B overlay one frame chart and one graph per work identity, with the same elapsed-time
window and duration scales. A is cyan with solid outlines; B is violet with dashed outlines.
The A/B checkboxes independently hide a series in both frame charts and work lanes without
changing selection, measurements or scales. Zero is each recording's first retained sealed measured frame, not a GPU
clock or shared wall-clock timestamp. The selected frame contains the cursor in a half-open
interval `[start, end)`; a gap, missing trial, empty recording or unsealed tail stays unknown.
Time alignment does not guarantee identical scene or animation state, particularly when data
was lost. Check scene settings and coverage before interpreting differences.

Enter **Comparison elapsed time (ms)** under **VIEW**, or click the shared timeline to move both cursors. The single
recording inspector follows the active trial. Its frame controls also move the paired cursor.
Choose a window size or zoom with the buttons/wheel; the overview and detail chart stay linked. Switching
trials or pairs preserves elapsed time; loading another document resets it. Invalid input preserves
the current selection. The API exposes `selectComparisonTime(elapsedMs)` and detached snapshot
fields `comparisonElapsedMs` and `comparisonWindowMs`.

CPU rows match channel IDs, retain configured order, and show the union of observed intervals
per channel. Channels may overlap one another; row durations cannot be added. Partial scope
coverage retains observed durations but has no delta. An unobserved channel stays unknown rather
than becoming zero, even if another channel was measured in that frame.

GPU interval rows match stable pass ID, compute/render kind and invocation. Duration-only passes
match unique labels within the same measurement kind; duplicate labels or multiple observations
for one frame remain ambiguous. Rejected passes retain their rejection reason; accepted intervals
can be compared even when another pass made the overall sample incomplete. Missing passes and
incompatible measurement kinds have no delta. GPU clocks are never aligned with CPU clocks.

Rows keep A's configured CPU/first-seen GPU order, followed by B-only identities, throughout the
pair. Labels come from the first recording containing the identity. Unobserved values dim without
removing their row. B − A uses explicit longer/shorter text and highlights nonzero differences;
these are individual frame comparisons, not evidence of statistical significance. The flat,
compact timeline layout follows the pre-rewrite viewer's visual reference.

## CPU/GPU lanes, events and navigation

Both the A/B view and the single-recording timeline include fixed CPU/GPU lanes. Their row
identities and missing-data rules are shared with the frame comparison tables. A bar represents
one correlated frame's duration measurement, not the precise start of GPU execution on the CPU
clock. CPU rows show scope interval unions. Unknown/rejected/ambiguous samples leave gaps;
measured zero remains a one-pixel mark. Outlined bars identify GPU measurements or partial CPU
coverage. A and B use the same height scale across their visible samples, with the frame budget
as its minimum. The displayed scale states its range; no values are silently capped.

Hovering previews values and a dashed cursor on both A/B lane plots without changing selection.
Clicking selects a time and updates both inspectors. A solid cursor marks the selection. Lane
labels stay fixed; hover titles and accessible readouts expose values and reasons for missing samples. With a lane focused, Left/Right selects the
previous/next recorded frame, Home/End selects the first/last, and focus stays on that lane.
A gap has no interpolated or reused measurement.

The A/B window selector and zoom buttons move both plots together. Ctrl/Command + wheel zooms
around the pointer's elapsed time. Horizontal wheel movement or Shift + wheel pans; ordinary
vertical wheel scrolling remains available for the page. **Comparison horizontal scroll** is a
labelled keyboard-accessible range control. Panning leaves selection unchanged, and selecting a
time outside the window brings it back into view. `comparisonWindowStartMs` in the viewer
snapshot records the visible window's start; zoom is bounded to at least 1 ms and at most the
measurement window.

The single-recording view uses its existing 50/100/200-frame range controls for zoom. Its lane
and frame charts share an elapsed-time axis, including any gaps between recorded frames.
Ctrl/Command + wheel steps through those frame counts; horizontal/Shift + wheel and **Recording
horizontal scroll** move the range without changing selection. At the recording's tail a range
can contain fewer frames than requested.

Events have exact elapsed-time markers and readable labels when space permits. Labels may be
thinned to avoid overlap; markers and the full event names remain available in the labelled
event selector. Selecting an event moves to its exact time, including an unknown frame if it
falls in a gap. Events on the right boundary belong to the next window. Imported labels remain
text and are never interpreted as HTML. No background refresh or animation loop is added.

## Counter lanes

Numeric counters appear below CPU/GPU lanes, in configured provider order and first-recorded
field order. B-only fields follow A's fields within each provider. Catalogs cover the whole
recording, so panning, hovering and missing polls never remove or reorder rows. Text, booleans
and fields that were never numeric remain available in raw frame evidence rather than graphs.

Each stem and point is an actual timestamped sample. There are no interpolated or held graph
segments between polls; zero is a visible point, negative values have a signed scale, and
unavailable values leave gaps. Each field has its own visible-value scale, shared by A and B.
Empty windows say **no samples**. Pointer, keyboard, zoom and scrolling use the shared elapsed
axis; A/B series toggles also apply to counters.

A/B identity is provider ID plus exact field name. Schema 5 has no counter unit metadata, so
these are **raw-value overlays**, not verified unit conversions or cross-trial deltas. Check
that host definitions remain consistent across recordings. Each recording uses its own first
retained frame as elapsed zero.

The counter inspector follows selection or hover and shows the latest earlier provider sample
with its age. This is a last observation, not a claim that the counter remained unchanged. A
null value, omitted field, non-numeric value, provider error or duplicate provider timestamp
invalidates the old value until another valid sample arrives. Before the first sample and
outside the recorded time range, values remain unknown. Row labels dim when neither series
has an exact sample at the cursor. Inspector rows retain their height through these changes;
full error details are available in cell titles.

## Captures and excerpts

The **CAPTURES** list restores the original spike-review workflow. A schema-5 automatic file
shows its recorded trigger and retains its original before/after window. Manual and recent
recordings show **detected spikes**, not an invented saved archive: frames strictly above twice
the FPS budget, grouped within ten retained frame positions, keeping the longest representative.
The list ranks up to 50 peaks by duration, with chronological tie-breaking and nearby event labels.

Click **OPEN** or an overview marker to select its trigger; Previous/Next capture moves through
rank order and wraps. Markers and the list belong to the active trial in A/B mode, using that
trial's elapsed origin and series color. Changing trials replaces the capture evidence. The
inspector identifies the nearest listed capture whose context includes the selected frame;
export is disabled outside those windows or in a timing gap.

Use a row's **EXPORT** or **EXPORT CAPTURE** in the inspector. Automatic captures export their
complete retained recording, including the trigger, truncation and all GPU diagnostics. Detected
spikes export a schema-5 manual excerpt with up to 120 frames before and after the trigger.
CPU timestamps, frame IDs and GPU clocks are preserved; events/counters are filtered to the
retained time window and GPU samples to the retained frame IDs. Missing window edges preserve
an explicit truncation flag. Unlinked GPU samples remain only when the entire original recording
is kept; excluding them from a subset also marks that excerpt truncated. Source truncation is
never cleared. Failed downloads leave the current recording and selection available.

A recording file contains one capture, not the live profiler's ten-entry archive. This workflow
does not combine unrelated files into a session or fabricate automatic capture metadata for an
offline-detected spike.

## Frame inspection

The timeline displays 50, 100 or 200 frames at a time, with range navigation, an editable range
start, exact-budget line and selected-time cursor. Click a bar, use Previous/Next frame, enter a
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
in the right inspector. Unlinked GPU observations are counted in the recording description.

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
  viewer.selectComparisonTime(250); // elapsed milliseconds, independent of frame IDs
  viewer.setRange(0, 100); // zero-based start, count 50/100/200
}
// viewer.load(recording), viewer.selectFrame(actualFrameId), viewer.snapshot()
viewer.dispose();
```

`load` and `loadComparison` accept typed data and validate/detach it before replacement. The JSON
import path additionally enforces the encoded-byte limit before parsing. Snapshots are detached.
Repeated disposal and late load/selection calls after disposal do not remount the viewer.

This slice provides local import, A/B review and individual-frame investigation. It does not add
live-window handoff, editing, statistical significance estimates or
full parity with the older viewer's frame-copy controls and nearby-event inspector.
The session overview covers the imported recording or selected A/B pair. Single-recording orange bars use
the exact budget; A/B frame-pacing comparisons retain their documented 1 ms or 5% tolerance.
