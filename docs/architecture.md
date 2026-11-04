# Architecture

How the panel and viewer behave, slice by slice, and the measurement rules behind them. For how to contribute, see [CONTRIBUTING.md](../CONTRIBUTING.md).

Run `pnpm check`, `pnpm test`, and `pnpm build` before committing.
Run `pnpm test:e2e` for changes to browser interactions or visible layouts.

`pnpm build` explicitly minifies production JavaScript with Oxc and CSS with
Lightning CSS through Vite. Development output stays readable. Bundle comparisons
already measure minified assets; gzip/Brotli figures describe additional compression.

Use the recommended Tailwind CSS IntelliSense extension in VS Code. Workspace
settings associate `.css` files with its Tailwind CSS language mode so `@source`
and `@import "tailwindcss" source(none)` are recognized without disabling CSS
validation.
The Tailwind language service requires a trusted workspace. In Restricted Mode,
use VS Code's built-in CSS language mode until you choose to trust the folder.

## Preact linting

`pnpm check` enforces hooks at the top level, complete hook dependency arrays,
keys on rendered lists, no array-index keys, and explicit button types as errors.
These rules are configured in `biome.json` alongside the recommended preset,
including its accessibility checks. Use stable item IDs for list keys and
`type="button"` for controls that should not submit a form.

## V1 platform support

V1 supports desktop layouts only. Mobile viewport widths are unsupported and
outside the v1 implementation and testing scope. Verify UI changes at desktop
widths; mobile layout issues do not block v1 releases.

## Browser interaction checks

Use Playwright for routine browser verification in this repository, including
screenshots; it runs its own browser instead of driving the user's Chrome tabs.

- `pnpm exec playwright install chromium`: install the test browser after a fresh
  checkout or Playwright upgrade.
- `pnpm test:e2e`: run the desktop Chromium suite headlessly.
- `pnpm test:e2e:ui`: open the interactive test runner to inspect and replay steps.
- `pnpm test:e2e:report`: open the latest HTML report and its screenshots/traces.

`playwright.config.ts` starts an isolated Vite server on `127.0.0.1:4178`; the
usual development server remains on 5173. Tests in `e2e/` use accessible roles and
labels through open Shadow DOM, with deterministic reference hosts. They cover
budget editing, focus and mode shortcuts, recording while frozen, capacity-save,
discard, viewer selection, downloads, successful imports and failed-import
preservation. The capture and viewer cases attach review screenshots; failures
retain traces and screenshots in ignored `test-results/` and `playwright-report/`.

Vitest excludes `e2e/`. `pnpm check` also checks the Node-based test configuration
via `tsconfig.e2e.json`, without adding Node globals to browser code. Playwright
and Node types are development dependencies and add no runtime package to the app.
Automated interaction checks support usability review; they do not replace human
judgment or manual screen-reader testing. See the official
[configuration](https://playwright.dev/docs/test-configuration) and
[Shadow DOM locator guidance](https://playwright.dev/docs/locators#locate-in-shadow-dom).

## Component styling

Use desktop-only layouts and the Geist-inspired theme: system sans-serif for words, system monospace for measurements.

Preact is the only third-party JavaScript runtime, and it is bundled. The library build guard rejects other bundled packages and external runtime imports. Do not add React compatibility or CDN scripts.

`src/theme.css` maps Geist primitives
(`--ds-*`) to Jank semantic roles (`--jank-*`) and Tailwind utilities. Prefer
`text-jank-text`, `bg-jank-surface`, `stroke-jank-over`, etc. for meaning. Default
Tailwind colors and text sizes are removed: use `text-label-12`, `text-label-13`,
`text-label-20`, `text-copy-13` and the heading tokens. Use whole class strings;
never assemble utility names from fragments. Prefer canonical utilities such as
`w-90` and `h-4.5` when Tailwind provides them; reserve arbitrary values for sizes
that have no equivalent utility. Dark is default; `.light-theme`
on the panel section or shadow host overrides tokens without alternate markup.

Use system sans-serif and monospace font stacks: no bundled font files, font CDN
or `@font-face` registration. Only Tailwind properties are injected into the host
document. The panel
entry excludes preflight and has a small shadow-local base; the preview entry uses
full Tailwind. Preserve the shared `focus-ring` treatment on every control.

`src/measurement.ts` defines measured values versus explicit missing-data reasons.
`MeasurementValue` displays numbers or reason tokens, with a screen-reader reason.
Never replace unavailable measurements with zero or derive GPU completeness from
counts. The current `HudSnapshot` API remains unchanged; unavailable FPS and empty
frame statistics map to `unknown`. Future adapters supply more precise reasons.

`src/panel-view.tsx` owns the HUD markup. Shared components live in `src/ui`:
`DisclosureSection` owns open/closed state, a full-width header and a collapsed
summary. `Button` / `IconButton` use native keyboard activation and `type="button"`;
unavailable actions require a visible reason ID and an explanation handler, and
never invoke `onPress`. `StateBadge` is non-interactive status; changing counters
are excluded from announcements. `Notice` pushes content and uses polite status
announcements except for errors, which use alerts. Its dismiss button has a label.
`src/hud-model.ts`
validates snapshots and calculates statistics. `src/panel.ts` retains the
synchronous `mountPanel`/`update`/`destroy` API and Shadow DOM lifecycle.
`src/panel.css` scans the TSX component and provides Shadow DOM styles;
`src/style.css` scans the page shell in `index.html` and the preview in `src/app.tsx`.
`src/main.tsx` mounts the app and handles hot-reload teardown. `src/app.tsx` owns
preview markup, scenario state and the HUD lifecycle; use Preact events instead
of manual DOM listeners for app controls.
Add new component sources to the appropriate stylesheet when needed.
Budget warnings use `data-over-budget:text-jank-over`.

Run `pnpm dev` and open `/checks/theme.html` for the desktop review/check page:
dark/light HUDs, unknown versus zero, computed contrast, focus, collapse, local
font-download absence, teardown and host-style isolation. It is excluded from the normal
production entry. `src/theme.test.ts` checks literal classes against compiled CSS;
add new source files to that check when adding components. Shared component
variant classes are also checked in `src/ui/components.test.tsx`.
`/checks/components.html` provides an interactive dark/light review of buttons,
blocked actions, disclosures, badges and notices without controlling a collector.

## Temporary annotation tool

During `pnpm dev`, the main preview, `/checks/components.html` and `/checks/live.html` include an
**Annotate** button in the top right. Select it, click an element, write a note,
then save. Picking suppresses the target's click action, including inside the
HUD's open Shadow DOM. Keyboard users can Tab to a control and press Enter;
Escape cancels picking. Notes can be edited or deleted in the sidebar or opened
from their numbered pins.

**Copy all feedback** exports Markdown for pasting into chat, with comments,
element locators, URLs, theme/scenario, viewport and captured document bounds.
Clipboard failure exposes a selectable text field. Notes stay in this browser's
local storage, shared across preview pages on the same origin. Nothing is sent
automatically. If storage fails, keep the tab open and copy feedback before
leaving; unreadable existing data is preserved.

The disposable implementation is under `devtools/`, with its own Shadow DOM and
stylesheet. The annotation entries use development-only dynamic imports and add no production
bytes. Remove the annotation modules and imports when finished; retain
`devtools/live-preview.ts` while the local collector preview is needed.
Neither tool adds a dependency.
Structural locators can drift when markup changes; hidden/missing targets remain
in the note list so they can be reviewed and re-picked. There is no screenshot
capture, source editing, or collaboration service.

## Commit messages

Stage only the files belonging to your change, then use the project-local
[Commitizen](https://github.com/commitizen/cz-cli) prompt:

```sh
git add path/to/changed-file
pnpm commit
```

Choose a type such as `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`.
Use an optional scope and a short, imperative description, for example
`fix(panel): reset notification preferences`. The prompt also asks about
breaking changes and related issues.

Commitizen creates a commit from staged changes. It is a development tool and
adds no JavaScript to the app bundle. Ordinary `git commit` remains available;
this setup prompts for conventional messages but does not enforce them with hooks.

## LIVE panel and collector integration

`src/live/model.ts` derives the four KPIs, CPU scope unions and overhead from a
structural subset of `jank.js` snapshots. `view.tsx`, `frame-chart.tsx` and
`metric-row.tsx` render the full panel. `mountLivePanel(container)` accepts
`update({ diagnostics, gpu, loading? })`; the older compact `mountPanel` API stays intact.
Both share the isolated base styles and teardown in `src/shadow.css` /
`src/shadow-view.ts`.

For a running collector, use `mountDiagnosticsPanel`:

```ts
import { mountDiagnosticsPanel } from "./src/live/diagnostics-adapter.ts";

const panel = mountDiagnosticsPanel(container, monitor);
// In the host's existing frame loop, after its collector/work calls:
panel.refresh(performance.now());
// At host teardown:
panel.destroy();
```

The adapter renders at most every 250 ms and measures snapshot/model/render work
with `monitor.measureRefresh`. It does not start a loop, enable scopes or dispose the collector.
Budget changes occur only through an explicit user action when the host supplies
`setTargetFps`. The host enables detailed collection
when wanted (`monitor.setExpanded(true)`); `createPerformancePanel` does so while mounted. Direct `update` calls are synchronous
and unthrottled. Failed snapshots leave the previous view intact.

Supply an optional third-argument GPU reader returning `LiveGpu`, or use
`adaptGpu(profile)` for the legacy collector's GPU shape. The latter preserves the reported span and pass sum: busy time, expected/timed
totals and completeness stay unknown.
Pass identity must be stable in native `LiveGpu` data. A missing invocation is not
measured zero. CPU averages exclude incomplete frames; overlaps count once per
system, while unattributed time subtracts the union across all systems.

`pnpm dev` starts a real browser simulation on the collector in `src/core`. `/checks/live.html` reviews dark/light, absent compute
and empty states, with annotations and geometry checks. No GPU workload is run.


### Loading sessions

The Loading tab reads optional host snapshots through `mountLivePanel.update`:

```ts
panel.update({
  diagnostics,
  gpu,
  loading: { current: preparation.snapshot(), history: preparation.history() },
});
```

`src/loading/model.ts` declares a structural subset of the collector's
preparation snapshots; it imports no collector. Supply positive, increasing session
IDs, a label, kind (`fresh-context`, `repeat-session`, or `editor`), status
(`loading`, `ready`, `failed`, or `cancelled`), `elapsedMs`, `pending`, and stage
counts (`stage`, `count`, `errors`, `cancelled`). An optional `failure` string gives
the host's failure reason. `elapsedMs: null` means unavailable; zero is measured
zero. The host owns the clock and lifecycle. Stage counts include active operations;
pending counts describe unfinished operations at a finished session's cutoff.
These counts are not byte progress or a percentage of all expected work.

History contains finished sessions oldest first; the panel retains the latest
eight plus current and deduplicates a finished current session. Invalid updates
leave the previous display intact. Omit `loading` or pass `null` for no source;
`{ current: null, history: [] }` means a connected source with no sessions.
Selecting history survives updates until that session is evicted. Freeze holds
the displayed loading details while the header/tab badges report latest activity.
Recording remains independent. Cold/warm labels reflect the host-supplied kind,
not an inferred speed improvement.

The optional timing/cache fields preserve compatibility with aggregate-only
preparation snapshots. Each stage can supply `busyMs` (active interval union),
`totalMs` (summed operation durations), `cacheHits`, `cacheMisses`, `cacheInflight`
and `bytes`. Omitted/null values stay unavailable; explicit zero stays zero.
Cache hit percentage uses hits / (hits + misses + shared requests), only when
every reported stage supplies those counters. These are cache observations, not
cache inventory. Received bytes include browser-cache response bodies and do not
measure network transfer or resident cache size.

For the waterfall, optionally attach `operations` to each stage:

```ts
operations: [
  { id: "texture-a", startMs: 0, endMs: 160, status: "ready" },
  { id: "texture-b", startMs: 80, endMs: null, status: "running" },
];
```

IDs are unique within the stage. Offsets are nonnegative milliseconds relative to
the session start, using the same clock as `elapsedMs`. Terminal statuses are
`ready`, `failed` and `cancelled`, with an actual end offset. Running operations
have a null end and extend only to the supplied session clock; after sealing,
they remain unfinished at that cutoff. Offsets and outcomes must agree with the
session/stage counts. The panel copies the data and rejects inconsistent updates.
Partial arrays are allowed: missing operations are labelled, never fabricated.
Complete timing derives active-wall unions and operation sums; partial timing
uses supplied aggregate durations or Unknown. Aggregate durations alone draw no
bars. Each series draws at most 128 merged intervals/markers with a truncation
notice; all observations remain included in totals. Nothing starts a local timer.

Set `comparisonKey` on sessions only when workload, backend and relevant settings
are comparable. A repeat session uses the most recent earlier successful cold
session with that exact key. Matching labels are insufficient. Wall-time deltas
require both sessions to be ready with no failed, cancelled or pending operations;
running/failed/cancelled sessions can show the cold reference without a speed claim.
A zero cold duration permits an absolute delta, never a percentage division by zero.

Open `/checks/loading.html` for simulated dark/light lifecycle examples, overlaps,
missing/partial timing, cache outcomes, comparisons, Freeze and simultaneous
capture. The real Three.js workflow is described below. The throttled
`mountDiagnosticsPanel` adapter accepts an optional sixth argument, a loading
snapshot reader. It shares the existing 250 ms measured refresh cadence, forced
refreshes and failure preservation; it never owns or cancels the source.

```ts
mountDiagnosticsPanel(container, monitor, readGpu, capture, readInstrumentation, loading.read);
```

The optional Three.js integration in `devtools/three-loading.ts` observes an
explicitly supplied, idle `LoadingManager`. Attach it before starting requests.
`start({ label, kind, comparisonKey? })` returns a run with `measure(stage, work)`,
`bytes(stage, count)`, `compileProgress(completed, total)` and `finish(status, reason?)`.
Seal Ready only after observed items and explicit stages settle successfully.
Cancellation seals a cutoff; the host separately aborts supported requests and
prevents late results from publishing. The observer does not abort a manager or
renderer. Dispose restores only hooks it still owns and ignores late observations.
Overlapping requests for the same URL retain counts but omit ambiguous offsets.
Observed manager items are not necessarily network requests or all loader calls.

Stage `compileProgress` reports backend work-item counts, separately from
operation counts. It is optional, validated and held by Freeze. The real
[Three.js playground](three-playground.md#loading-and-compilation) exercises
both renderers with loaded assets; its adapter and assets stay outside production.

### Counter values

LIVE → Counters groups `diagnostics.systems[].values` under each system label.
Supply scalar numbers, strings, booleans or `null`; unsupported values render as
Unavailable, measured zero stays `0`, and booleans render as Yes/No. Labels split
camelCase and underscores; the original key remains available on hover.
Use explicit key suffixes to declare units: `durationMs`, `widthPx` and
`trackedStorageEstimateBytes`. Bytes display in B/KiB/MiB as appropriate; arbitrary
keys have no inferred unit. Numeric display is rounded to four significant digits
for fractions, while integers retain their precision. Freeze holds these values
with the displayed snapshot. Recordings retain original keys and scalar values;
formatting does not change the file format. Counter inspection in the recording
viewer remains planned work.

Keep configured instance counts, submitted work and pixel visibility distinct.
The Three.js playground records these as scalar counters on its existing Render
submission system; its scoped observer and field meanings are documented in
[Visibility and instances](three-playground.md#visibility-and-instances).

### Temporal history supplied by the host

Report temporal state through the same render system's scalar counters; no new
collector or recording schema is needed:

| Key                          | Meaning                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `temporalEnabled`            | Whether the host's temporal pass is enabled; `null` if unknown.                                |
| `temporalHistoryValid`       | Whether the host considers its history usable; `null` when unavailable or inapplicable.        |
| `temporalHistoryAgeFrames`   | Completed accumulation frames since the last reset; `0` at a known reset, `null` when unknown. |
| `temporalHistoryResetReason` | Last host-reported reset reason, such as camera cut or resize; `null` when unavailable.        |

Latch these with the work they describe, alongside the diagnostic `frameId` when
available. The host owns validity, accumulation and invalidation policy. Jank does
not infer resets from camera movement, resize, GPU epoch changes or frame spikes.
For multiple temporal passes, use distinct counter prefixes rather than combining
unrelated histories. Missing fields stay absent; supplied `null` renders Unavailable.
Freeze holds the displayed values; recordings preserve the raw scalars.

`/checks/live.html` supplies a labelled valid history and an **Invalidate reference
history** button for a camera-cut example, in both themes. The Three.js stress
scene has no temporal pass: enabled is No and its history fields are Unavailable.
Viewer counter inspection follows in step 7b.

### Instrumentation controls

Capture ends with GPU timing and Trace events switches. CPU scopes remain
requested by the host; the panel never calls `setExpanded` for these controls.
Pass an optional fifth argument to `mountDiagnosticsPanel`, or the
`instrumentation` option to `mountLivePanel`: a synchronous, read-only function
returning the current `gpuTiming` and/or `traceEvents` controls.

Each control supplies `enabled: boolean`, an optional synchronous
`setEnabled(enabled)` callback, and an optional `unavailableReason`. Missing
settings show Unavailable; a missing callback makes a supplied setting read-only.
A reason blocks the action even when a callback exists. Keep unavailable reasons
specific to the host/device. For example, with a host-owned trace setting:

```ts
const readInstrumentation = () => ({
  traceEvents: {
    enabled: host.traceEnabled,
    setEnabled: (enabled: boolean) => host.setTraceEnabled(enabled),
  },
});
const panel = mountDiagnosticsPanel(container, monitor, gpuReader, capture, readInstrumentation);
```

The host must update its reported setting before the callback returns, or throw
on failure. The panel rereads settings on activation and after the action; it
never assumes success or derives probe settings from the last GPU sample.
Read failures disable the controls with a reason; action failures use the shared
notice slot. Settings keep updating while Freeze holds measurement values.
Changing settings does not start/stop capture, and destroying the panel does not
reset host instrumentation. Native GPU timing changes reject pending queries;
the recording retains their explicit rejected evidence. Call `panel.refresh(at, true)` for immediate updates
after external configuration changes when the normal host loop is stopped.

The real browser preview connects Trace events to the collector's
`setDevToolsEnabled`. The Three.js playground also connects GPU timing to its
native probe and keeps its external checkbox synchronized. Trace events emits
browser performance entries; recording a DevTools session remains a separate
browser action. `/checks/capture.html` uses explicitly simulated controls in the
Idle dark fixture to review host changes and failures.

### Panel modes, freeze and budgets

The LIVE view keeps mode/freeze state per mount with Preact hooks. Full is 360 px,
mini is 240 px, and line is 360 × 28 px. All use the same 180-frame statistics and
chart window. `M` cycles modes and `F` toggles Freeze while focus is inside the
panel; shortcuts ignore form fields, composition, repeats and modifier keys.
Mode changes preserve disclosures and move focus to a visible control.

Freeze copies the displayed model. Metrics and GPU details stay held while the
host keeps collecting; current recording/capture badges and the newer-frame count
continue updating. Resume shows the latest valid model. Changing budget rejudges
the held frames too. No collection-pause API is called.

The full LIVE graph supports hover and keyboard inspection. Tab to the graph,
use arrows for adjacent frames and Home/End for the window boundaries; `F` still
toggles Freeze. The readout shows the frame ID, interval and signed budget delta;
its warning color follows the same tolerance as the statistics. By default it shows
the worst visible frame; hover or keyboard inspection replaces it with the selected
frame's details. The worst frame keeps its ring and Worst KPI. Mini keeps its
compact summary. Both charts use 1/2/5 scale steps, expand immediately for spikes
and shrink only after two seconds of lower requirements on the displayed frame
clock. Budget changes, empty data and restarted frame clocks reset the scale.

The optional `diagnostics.events` history contains `{ at, label, detail }` records.
Use relative milliseconds from the same collector origin as `frame.at`, not wall
time. The panel copies the last 200 supplied events, sorts by timestamp and rejects
non-finite timestamps or labels/details longer than 240/2000 characters. An omitted
history means not supplied; `[]` means no events reported. Existing recordings
already preserve these records; no new file format is needed.

LIVE → Events shows the retained history with collector time, matched frame ID and
details. Its summary age uses the displayed frame clock, so Freeze holds ages,
list and markers together. Full and mini graphs align diamonds with frame centres
only when an event falls in a measured interval `[at - interval, at)`. Gaps,
zero-length intervals, older events and unsealed frames never invent a match;
unmatched events remain in the list. A frame can contain multiple events. In full
mode, hover the rail or Tab to **Inspect events**, then use arrows/Home/End to
inspect each event. The timeline sits flush with the graph's bottom edge; its
detail readout appears only during hover or keyboard inspection and replaces the
frame readout until inspection ends. Mini adds no keyboard stops. These markers
show temporal association, not proof that an event caused a spike.

`mountLivePanel` accepts optional `initialMode` and `onBudgetChange(milliseconds)`
options. The host owns the budget: its callback applies the change and publishes a
new snapshot with `update`. Without a callback, budget is read-only.
`mountDiagnosticsPanel` wires this to the collector's optional `setTargetFps` and
refreshes immediately after a change. Supported presets are 30, 60 and 120 FPS;
custom budgets accept finite values from 1 to 1000 ms, matching the collector's
1–1000 FPS range. Failed edits show an error and preserve the displayed data.
Apply closes the custom editor after a successful change. Cancel discards the
draft without changing the budget; select Custom again to edit the saved value.

Compact state badges keep stable accessible names. Line drops the over-budget
share for frozen/capture states, keeping p95 and FPS. The strip measures rendered
badge widths and compacts Frozen only when needed; the capture word remains
visible. Automatic-capture progress and cooldown use the collector's frame clock;
loading and comparison state remain later stages. No global store or browser-storage state
is introduced.

### Manual capture and recording viewer

Create one host-owned capture controller per collector and retain it when
remounting the panel:

```ts
import { createCaptureController } from "./src/capture/controller.ts";

let closeViewer: (() => void) | undefined;
const controller = createCaptureController(monitor);
const panel = mountDiagnosticsPanel(container, monitor, undefined, {
  controller,
  onOpen: async (capture) => {
    const { openRecordingViewer } = await import("./src/viewer/mount.tsx");
    closeViewer?.();
    closeViewer = openRecordingViewer(document, capture);
  },
});
```

Keep the returned viewer cleanup and call it at host teardown. The capture source
supplies `recordedFrames`, `startRecording`, `stopRecording`, `disarmCapture` and
`export`; capacity comes from its validated export. Call `panel.refresh(at)` after
**every sealed frame**, before the next frame can trigger another capture. The
adapter observes automatic progress between display refreshes with
`snapshot(false)`; subscribers still update only every 250 ms. If collection
continues while the panel is unmounted, the host must keep calling
`controller.refresh(monitor.snapshot(false), false)` after every sealed frame.
The final `false` suppresses display notifications, not capture processing.
Destroying the panel only unsubscribes its view.

Rec / `R` starts or saves a manual recording; the Capture tab provides Stop and
save, Discard, capacity and the latest ten saved captures. Starting manual capture
disarms Auto. Empty recordings never export the recent buffer. Discard does not
clear live history. Failed saves keep the stopped buffer available for Retry save
or Discard and block replacement. Captures are memory-only; export to retain them.
Freeze does not affect recording. Full mode can show the collector-clock duration
in its Rec badge; compact modes omit the counter to preserve metrics.
Full and mini graphs mark the manual recording's start-frame boundary; a frozen
graph only marks recorded frames in its held window. Live and Capture share a
fixed-height body and overhead footer. The saved notice opens/exports directly,
takes precedence over Frozen, and delays expiry while its action has focus or a
viewer is open. Saved rows show age, worst/trigger frame and explicit GPU coverage state.

### Recording viewer navigation

The standalone viewer and capture dialog share a desktop shell: file toolbar,
summary, overview/range brush, navigation, timeline and independently scrolling
frame inspector. Open at the capture trigger when retained, otherwise the worst
frame. Successful imports reset to that selection and Fit; failed imports keep
the current file, selection and zoom. Export always saves the whole recording.

Drag between the overview handles to slide the window without changing its width;
it stops at the recording boundaries. Drag either solid, dotted handle to resize,
or drag outside the window to select a new inclusive range in either direction.
Escape cancels an active drag. Tab to **First visible frame** or **Last visible
frame** and use arrows/Home/End to adjust without dragging.
The timeline selects frames by click/drag or keyboard. Left/right step frames,
Home/End select first/last, W selects worst, and J/K find previous/next frames
strictly above 2× budget. This navigation threshold is separate from capture rules.
Shortcuts ignore form inputs, composition and modifier keys, except Shift+? for
help. **Shortcuts ?** or `?` opens keyboard/drag help; Escape closes it without
closing a parent capture viewer.

Zoom in/out halves/doubles the visible frame count around selection, down to one
frame; Fit restores the whole recording. Navigation outside the range pans it
without changing its width. Moving the range away from selection clamps to the nearest
range edge. Plots use uniform frame spacing and actual frame IDs, including gaps;
duration labels use recorded timestamps. Geometry is memoized by recording/range.

The five summary tiles always describe the entire recording, independent of zoom.
Spikes are individual frames strictly over 2× budget, ranked by duration with
chronological tie-breaking. This is separate from the recorded capture rule and
does not merge frames into episodes. Every spike has an overview tick; labels show
the top three and the selected spike, stacking to avoid collisions. J/K still
visits every spike chronologically. Selecting a marker keeps the current zoom width.

The purple bar shows an actual retained automatic-capture window. Available metadata
splits it into before-onset, qualification, trigger/episode and after phases. The
inspector reports retained versus requested before/after frames, clipping and the
host's stop/recovery reason. Counts use records, not subtraction of frame IDs.
Manual/recent recordings do not acquire an inferred automatic window; missing
trigger/episode metadata remains unknown.

GPU **Why?** is a native popover using the shared frame-coverage calculation.
Complete includes explicitly empty GPU frames. Unknown inventory and missing
records stay separate; legacy aggregates cannot establish per-frame coverage.
Recorded problem frames link to their GPU evidence in the inspector; causes are
paged 20 at a time. Escape/Close returns focus to Why without closing a parent
capture viewer; outside click dismisses. Missing records have no retained cause.

The inspector's **Frame / Recording / Captures** tabs support arrows/Home/End,
retain frame selection and start each tab at the top. Captures contains the current
file's capture context, not a cross-file collection. Recording shows the retained
source environment. Frame groups matching CPU scopes, shows their interval shares
(which can overlap), and labels its median-change comparison as a heuristic.
Only complete frames contribute to those medians; an absent scope is zero only
with complete coverage. The heuristic establishes no causal relationship.

Frame counters use the latest sample **at or before frame start**. Never use a
future sample or the untimed `recording.systems` catalog for historical values.
Age is elapsed time since that sample; Δ compares the previous retained snapshot.
A missing key or null is unavailable, not zero and not a reason to reuse older
values. Search and 20-counter pages keep large catalogs bounded. Pins are limited
to four numeric counters and reset on successful file replacement; failed imports
preserve them. Their stepped lanes share frame selection/range, have independent
recording-wide scales, and break at missing values. Zero/negative numbers are valid.

**Evidence** shows retained CPU timestamps and relative GPU milliseconds/precision,
not reconstructed raw nanoseconds. **Copy frame JSON** copies the selected frame,
explicit GPU links and eligible counter snapshots. Clipboard denial/unavailability
shows a read-only, selectable fallback. The normal export still saves the entire
recording. Inspector and pinning code stay within the lazy viewer bundle.

Review `/checks/viewer.html`, `?theme=light`, `?episode`, or `?mixed` for labelled
reference states. `?large&dense&many-failures` exercises 6,000 frames and bounded
labels/cause lists. Desktop layout is checked at 1440 × 1000 and 1024 × 604.
Frame time, events, CPU scopes, GPU passes and frame context use the same horizontal
frame positions, selected cursor and readout column. Click/drag any timing lane,
or focus it and use the existing frame shortcuts. Event markers select their matched
frame; events in gaps or outside retained intervals remain separately listed.
Budget ticks use frame-budget multiples, with amber shading only between budget and
the 2× spike threshold. CPU/context share one recording-wide scale; GPU durations
use a separate scale and clock.

CPU lanes group by system and label and merge overlapping intervals within that
group; different lanes can still overlap. Unattributed time subtracts the union
of scopes from the frame interval only with complete coverage. Profiler cost is
recorded collection plus refresh time and may overlap scopes; it is unavailable
for legacy recordings. Neither context lane is CPU utilization.

GPU lanes group by kind, label and occurrence within each frame, not persistent
invocation identity. Only explicit diagnostic frame links are used. Valid zero,
missing frame records (short baseline hatching), rejected results (✕), pending,
omitted/unknown and absent invocations stay distinct. Legacy aggregates cannot
populate pass lanes. Partial CPU values carry an asterisk and an explanation.

Quiet CPU/context lanes use 20 px when their visible values stay within 10% of the
shared scale with at most 2% variation. Hover and focus keep row heights stable;
**Expand quiet lanes** or **Lanes** explicitly expands them to 32 px. Lanes also
toggles each optional group. Groups page 16 lanes at a time; models use sparse
values and memoize range geometry.
`?missing` and `?many-lanes` cover absent channels and long lists. Counter inspection,
pins and A/B remain later slices. Viewer imports stay lazy and outside the standalone panel.

### Automatic capture and rules

Optional `armCapture(rule)` enables Auto. A legacy spike-only source consumes
`thresholdMs`, `beforeFrames`, `afterFrames` and `cooldownMs`; extended settings are
compiled by the controller. A supporting source must include `capture.triggerFrame` and
`capture.remainingFrames` in snapshots. The controller checks arming, saves each
completed recording once and derives cooldown from the last captured frame's
timestamp plus the collector's cooldown. Frames must share the recording clock.
The legacy source requires a snapshot per frame while Auto is on; this is extra
observation work, even though rendering stays at 4 Hz.

Transport Auto, the Capture switch and `A` share the same guard. Arming during
manual recording explains the block and preserves the recording. Starting manual
recording disarms Auto. Turning Auto off during after-context discards that active
automatic window; saved captures remain. A failed automatic export disarms Auto
to protect the stopped buffer for Retry save or Discard.

The default uses a spike threshold of twice the budget **at arming**, up to 120 frames
before and 60 after, bounded by source defaults/capacity, and the source's cooldown
(5 seconds in the collector). Budget changes do not silently re-arm an
active rule. An explicitly edited threshold is retained at subsequent arming.

`createRuleCaptureSource(collector)` in `src/capture/rule-source.ts` adds the complete
rule engine to a legacy source. Pass the wrapped source to both the capture
controller and diagnostics panel. The host still owns the loop: observe **every
sealed frame**, including while the panel is unmounted. Duplicate snapshots are
safe; gaps and collector restarts report an integration error requiring re-arming.
The adapter owns no timers.

- Spike: one interval above the configured threshold.
- Sustained / Episode: consecutive intervals above the arm-time budget accumulate
  to the configured duration; an on-budget frame resets qualification. Episode
  selects Whole episode by default; either trigger can use either retention mode.
- Fixed window: retain the trigger plus the requested before/after frame counts.
- Whole episode: later over-budget frames restart quiet recovery. Once quiet is
  reached, retain after-context; a crossing during after-context does not extend
  that episode. The time limit (measured from onset) and capacity are hard stops
  and can clip after-context. Cooldown begins at the last retained frame.

Before/after seconds round **up** to frames at the arm-time budget. The editor
validates host limits and combined capacity before changing anything. Drafts leave
the active rule running; Cancel/Escape discard them and return focus to Edit rule.
Apply saves settings while Auto is off; Apply and re-arm updates an active rule.
Applying during an automatic recording or with unsaved data is blocked to preserve
that capture. While the editor is open, panel shortcuts are suspended.

The adapter retains owned CPU frame/scope history and recomputes overhead over the
retained frames. The legacy export API does **not** expose pre-trigger counter or
GPU history to this adapter; those channels can cover only the available exported
portion. No missing coverage is inferred. A host history API is needed to improve
that limitation. Keep the per-frame snapshot cost inside `measureRefresh`.

Purple full/mini rails mark the captured window and trigger. Frozen charts mark
only frames actually present in the held window. Automatic saves use the same
notice/list/export flow and open the viewer at the trigger. Blocked-action notices
take priority over saved/Frozen notices and offer Stop and save only where the
manual recording card is not already visible.

`/checks/capture.html` includes eight manual/automatic states in both themes.
Use Edit rule, Auto, Inject 48 ms spike / 6 slow frames, Advance 8 quiet frames and
Advance 5 seconds to exercise qualification, recovery and re-arming. The tiny
reference capacity makes clipping easy to inspect; the real simulation uses 6,000
frames. Open inspects the saved trigger frame.

### Recording format and viewer

`src/recording/format.ts` and `types.ts` adapt the existing MIT jank.js recording
codec, preserving version 2 and legacy version 1 imports, bounded collections and
the 32 MiB file limit.
`src/viewer/` contains the file flow, overview, selected-frame details and mount.
The full-screen native dialog loads only on Open; `/viewer.html` is a separate
build entry for local files. Invalid or slower superseded imports cannot replace
the current recording. Frame selection starts at the trigger when present,
otherwise the worst frame. GPU matching requires an explicit diagnostic-frame ID;
unknown completeness and absent timings remain unknown.

Optional version-2 `capture.context` records the compiled rule, onset/trigger/end
frame IDs and timestamps, end reason, qualifying-frame count and actual retained
context. Imports validate that metadata against the recording and remain compatible
with older version-2 files without it. The viewer shows rule and recovery/clipping
context now; full phase strips and lanes remain step 7b.
The header reports recording duration and target FPS; summary tiles include the
worst frame. Import failures name the failed file and the retained recording.
Dismissal returns focus to Open file.

The optional live browser simulation now enables capture. Production reference
samples do not pretend to record; `/checks/capture.html` provides an interactive,
labelled 12-frame reference host for capacity, retention and viewer review.
Automatic rules and full recording inspection are available in the capture/viewer flow.

### GPU measurement evidence

Follow [GPU integration](gpu-measurements.md) for the optional native WebGL2
and WebGPU adapters, host-owned history, delayed capture finalization and review
page `/checks/gpu.html`. GPU inventory is an explicit host assertion; incomplete
or legacy records never imply full coverage. Display timed pass sums separately
from device busy time. Preserve invocation rejection reasons, unknown precision
and the GPU clock domain when importing/exporting recordings. The default preview
still runs a CPU workload; native adapters require the host's actual renderer.

### Synthetic panel demo

Open `/?demo` during `pnpm dev`, or choose **Demo: simulated CPU + GPU** in
Preview source. The LIVE review page links to it too. This development-only source
needs no GPU support: frame intervals, scopes, pass timings,
counters and overhead are all explicitly generated reference data.

A deterministic 16-second sequence cycles through smooth frames, an 80ms CPU
spike, CPU/GPU bursts and recovery. Buttons inject another spike or two-second
burst. CPU bars retain their normal window averages; GPU samples are two frames
behind, matched by frame ID. Pause stops the synthetic clock; Freeze only holds
the panel display. Four updates per second advance synthetic time; background-tab
throttling slows playback instead of generating a catch-up workload. Source changes
dispose the interval and panel. Recording remains in the real collector examples.

### Three.js CPU/GPU playground

Renderer fault hooks live in `devtools/three-errors.ts`. Preserve existing callbacks,
WebGPU promise identities and host-owned error scopes; restore only hooks still
owned by the observer. Asynchronous error receipt does not identify the originating
GPU frame. Use the playground's shader/validation fault buttons and native GPU
suite when changing this boundary; intentional driver console errors are expected.

Open `/checks/three.html` during `pnpm dev` for the shared WebGL2/WebGPU scene,
CPU/GPU stress presets, native probes and the normal capture/viewer flow.
See [the playground guide](three-playground.md) for measurement boundaries,
Jarvis access and `pnpm test:e2e:gpu` hardware checks. Three.js is a development
dependency confined to this example; the production runtime guard is unchanged.

## A/B comparison runner (step 8a)

`createComparisonController` in `src/compare/controller.ts` takes the same capture
controller used by the panel, two host-reported variants (`A`/`B`, each with a
label and scalar settings), the setting under test (`change`), and synchronous
`activate(variant)` / `restore()` callbacks. Save the original workload before
switching; restore it on every exit. Settings are copied at construction: create
a new controller when the host's variant definitions change. Use a dedicated
controller per capture source; do not share its recorder while a run owns it.

Pass it as `mountLivePanel(container, { capture, comparison })`, or as the seventh
argument to `mountDiagnosticsPanel`, after the Loading reader. Call
`comparison.advance(false)` after **every sealed host frame**, before capture
observation, independently of Freeze, panel visibility or refresh throttling.
The diagnostics adapter publishes progress on its existing refresh cadence.
Direct `mountLivePanel` hosts call `comparison.advance()` at their UI cadence too.
No new RAF/timer loop is installed; only GPU drain has a safety timeout. Call
`comparison.destroy()` when the host is disposed, not when only its view closes.
Call `comparison.fail(reason)` if the host itself fails, so the export records why the
run ended; reasons are bounded to keep finished trials importable. Wrap the per-frame
`advance(false)` in `measureRefresh` so its cost reaches the overhead footer.
`devtools/three-scene.ts` is the reference integration; see
[the playground](three-playground.md#ab-comparison).

Plans allow 0–10s warm-up, 0.1–30s measurement and 1–5 alternating pairs (AB, BA,
AB…). Defaults are 0.5s / 1s / two pairs. Timing uses the recording's monotonic
sealed-frame clock and requires an initial completed frame. Measurement starts
at the last warm-up boundary; its first interval is entirely after that boundary.
Capacity exhaustion before the requested duration fails the trial. Warm-up is
excluded from exports. The reported budget must remain fixed throughout the run.

Capture must be idle, including Auto, pending saves and GPU finalization. Rec,
Auto, the Capture controls and `R`/`A` explain the guard without stopping the run.
Loading remains independent. Observable external capture changes, clock resets
or budget changes interrupt the run; the runner leaves an externally owned
recording alone. Hosts must preserve exclusive recorder ownership: stop/restart
operations that leave an indistinguishable snapshot cannot be detected from that
snapshot. Internal trial recordings never become saved manual captures.

GPU finalization reuses the source's abortable `finalizeGpu` hook and fixed frame
window. The plan allows 0.5s per drain; a 1s watchdog catches a broken hook. Stop
aborts unfinished finalization; late results cannot enter a later run. Only fully
finished trials are retained. Failed/stopped runs can export their completed
prefix, with missing pairs left incomplete. Run again replaces the retained run;
export first to keep it. No storage or upload is performed.

`src/compare/model.ts` validates the experimental `jank.js-comparison` v1 envelope,
ABBA order, measurement bounds, settings, budget, coverage policy and every nested
v2 recording. Imports/exports are limited to 32 MiB. JSON is a file format, not
an authoring interface. The panel uses labelled plan fields and a settings table.
Coverage policy is stored with the run (20 samples and 80% by default); the shared
results model validates it per metric. The viewer accepts this envelope as well as
single recordings (see step 8c below).
Review the explicitly simulated host at `/checks/compare.html`; use **Finish
current trial** to advance it without adding artificial delays to the app. The real
host is `/checks/three.html`. `pnpm test:e2e:gpu` runs it on native hardware.

### Comparison results (step 8b)

`src/compare/results.ts` derives results from validated trial recordings, memoized
by bundle in the panel. Every planned trial must meet its stored sample minimum,
metric coverage and measurement-window coverage. Missing trials, overlapping
frame intervals and failed requirements produce Unknown with a specific trial
and threshold; **View trial** focuses that row without scrolling the host page.

CPU samples union scopes only in complete frames with no dropped scopes. GPU
samples sum timed invocations only with complete, explicitly frame-linked
inventories; known empty inventories are zero, missing/legacy data are excluded.
These describe instrumented work, not CPU/GPU utilization. Frame samples use
recorded intervals. Median averages the middle two values; p95 uses nearest rank.
CPU over-budget uses the budget directly; comparison frame over-budget uses a
`max(1ms, 5% of budget)` tolerance, separate from LIVE/capture thresholds.

A/B values are medians of per-trial statistics with equal trial weight. B − A is
the median of **within-pair** differences. The paired range is their observed
minimum/maximum, not a confidence interval; one pair produces a point range.
Zero-to-zero means no observed difference, not equal performance. Rate differences
use percentage points. Keep the quick-estimate caveat visible above Method.

Per-scope changes reuse `(system, label)` identity and interval unions. An absent
scope is zero only in a complete CPU frame. Show the five largest absolute paired
median changes as a heuristic; scopes can overlap and their medians cannot be
added. Settings differences do not establish causes.

The panel leads with the answer once idle: status and export, verdict cards carrying
p95 and over-budget rows, Method, per-scope changes, the trial list, then the plan.
While running, the trial card comes first. A passing trial list folds behind its
disclosure and opens itself when a recorded trial fails; **View trial** also opens
it. When no trial carries GPU timing the host has no source, so GPU reads **not
recorded** once rather than failing every trial. If only some trials lack it, that
remains a coverage failure and Unknown. The viewer keeps the full results table.

Review `/checks/compare.html#results` for both themes and simulated faster,
slower, inconclusive, unchanged, opposing-scope, low-coverage/sample and stopped
cases. These use the production results component. A/B viewer alignment and
real Three.js comparison runs remain steps 8c/8d.

### Comparison viewer (step 8c)

`/viewer.html` and the capture dialog's **Open file…** accept recording files and
`jank.js-comparison` v1 bundles. `src/viewer/document.ts` dispatches to the existing
bounded codecs; every nested recording is validated before replacing the open
file. A failed import preserves the current file and inspector state; a newer
file request supersedes a slower read. **Export JSON** retains the full comparison,
including partial runs, settings, policy and nested recordings. Nothing is uploaded.

`src/viewer/comparison.tsx` reuses the panel's verdict cards, results, per-scope
changes, Method disclosure, trial requirements and settings table. Results are
derived from the imported recordings, never trusted from an imported summary.
**View trial** selects its pair, opens Trials and focuses the failing row. **Show settings** selects
Settings; its badge counts differences besides the declared change. Tabs support
arrow keys, Home and End. Graph and inspector panes scroll independently. The
summary has a bounded scroll area at short desktop heights; header/footer and
host page stay fixed.

Review `/checks/viewer.html?comparison=mixed` or add `&theme=light`. Other comparison
values are `faster`, `same`, `inconclusive`, `gpu-gap`, `scope-shifts`, `stopped`,
`low-samples` and `low-window`. These fixtures are explicitly simulated and stay
outside production. Add `&spikes` for varying frame times and spikes.

Pair selection reports A-then-B/B-then-A run order. The 320px frame-time plot aligns
each variant from its own measurement start, using actual frame intervals rather
than matching frame IDs or ordinal positions. Warm-up is excluded. Gaps and
unrecorded trials remain empty, with explicit missing readouts. Invalid overlapping
intervals suppress that series. Summary verdicts still describe all pairs.

The shared vertical domain includes both variants and the budget; a nonzero lower
bound has an axis-break mark and `ms · zoomed` label. A is solid/round; B is
dashed/square. Separate readouts preserve both values when lines coincide. Click or
drag the graph to select an elapsed time; hovering previews one and returns to the
selection when the mouse leaves, so it survives the trip to the inspector. Arrow keys adjust by at least
1ms, Page Up/Down by 10% of the visible range, Home/End select its edges. Selecting
a pair resets its cursor; a failed import preserves selection. Decorative markers
are bounded to 24 per variant within the visible range, while paths retain every
frame and spike.

`src/viewer/comparison-timeline.tsx` owns the cursor shared by the frame graph,
CPU scopes, GPU passes, frame context and numeric counters. All tracks support
the same pointer and keyboard controls. Groups show at most 16 lanes per page;
paging preserves time, while switching pairs resets time and paging.

The lane model reuses the recording viewer's interval unions and evidence rules.
CPU scopes match by system/label; GPU passes by kind/label/occurrence within a
frame, using explicit frame links. Known zero, partial, pending, rejected, unknown,
absent and missing remain distinct. Partial CPU values carry `*` and do not enter
the plotted line. Hatching marks unavailable intervals; lines never bridge gaps.
GPU duration placement identifies the host frame, not GPU execution on the CPU
clock. Unattributed time includes waiting; overlapping lanes must not be summed.

CPU/context and GPU groups have separate scales shared across A/B. Each counter
has its own shared signed range, using the latest sample at or before each frame
start. Readouts show sample age at frame start; future and final snapshots never
fill missing measurements. Add `&lane-states` to a comparison review URL to inspect
measurement states, or `&many-lanes` for pagination. Counter samples are included
in the simulated comparison fixtures.

Every frame/timing/counter track has a signed, zero-centred **B − A** lane sharing
the cursor. `comparison-difference.ts` walks both interval lists and splits at
either side's frame boundaries. It subtracts only two measured values; missing,
partial or overflowing differences stay unavailable and hatched. Zero is a known
value. These elapsed-time differences are descriptive, not statistical estimates.

The **variant A/B** buttons toggle lines, markers and direct readouts, including
counter lanes. Visibility leaves scales, differences and summary results intact;
both series may be hidden. It persists across pair changes and failed imports,
and resets when a new file replaces the current one. Pair changes still reset
the time cursor and lane pagination.

The overview above the frame plot sets the visible elapsed range, using the pure
operations in `comparison-range.ts`. Drag the window to pan at fixed width, a handle
to resize, or outside the window to select a new range; a click without movement
changes nothing, and Escape cancels a drag. At full width nothing lies outside the
window, so start with **Zoom in** or a handle, as in the recording viewer. Focused
handles take arrows (at least 1ms), Page Up/Down (10% of the run) and Home/End.
**Zoom in/out** halves/doubles around the cursor, down to 1ms; **Fit** restores the
run. The cursor stays inside the range and moves to the near edge only when excluded.

Every frame, lane and difference track maps one window through an SVG `viewBox`
over unchanged paths. Vertical scales still span the pair and the summary still
spans all pairs, so zooming cannot change a value. Changing pair or replacing the
file resets the range; a rejected import preserves it.

The inspector's **Frame** tab reads the frames under the shared cursor, previews
included. `comparison-frame.ts` pairs them by elapsed time, never by ID or ordinal:
they overlap in time in separate runs, so they are not matched work and their
differences describe these two frames only. CPU, GPU, context and numeric counter
rows show A, B and B − A, largest difference first. Only two measured values produce
a difference; partial, missing, pending, rejected, unknown and overflowing values
show why instead. A row is dropped only when neither frame has that scope or pass.
Each variant's **Full details and evidence** disclosure reuses the recording
inspector's `FrameDetails`, including GPU counts, the median heuristic, counter
deltas, Evidence and **Copy frame JSON**; its "At" time names the trial's own clock.
Pins are omitted because counters already have lanes. Like Results, the tab keeps
both variants when a series is hidden. An unrecorded time or trial states its reason
and offers no details for that side. Real host switching and native GPU validation
are 8d.
