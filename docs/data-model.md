# Data model and custom views

The capture engine, import/export schema, inspector and view model are independent of the bundled panel and viewer. A custom live panel or recording viewer can replace them without rewriting collection. Everything runs locally in the browser; there is no server, account or upload service.

## User manual

The [user manual](user-manual.md) describes the live panel and recording viewer. Applications host the tool independently and can link to their own integration instructions.

## Scope

| Decision                        | Implemented contract                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU timing stays narrow      | Optional Three r186 adapter; feature detection, delayed results, explicit frame links and unavailable states. Broad renderer support and compute profiling are deferred.  |
| Small DevTools integration      | Opt-in named system scopes and event markers.                                                                                                                             |
| Untracked time in the inspector | Union of captured scopes, then interval minus that union. Called **unattributed frame interval** because waiting and browser scheduling are included.                     |
| Live jank.js cost               | Rolling collection and exclusive synchronous view-refresh mean/peak values, also stored per frame.                                                                        |
| One-file offline viewer         | `OPEN RECORDING VIEWER.html` imports a local JSON without network requests.                                                                                               |
| Timer and environment context   | Every v2 recording stores CPU timer observations, isolation status, browser/platform, concurrency, viewport and application/version metadata. Unknown values remain null. |

Also implemented: manual recording, a bounded rolling history, automatic spike windows with cooldown, configurable FPS budgets, frame/range inspection, v1 migration, strict import validation and lifecycle cleanup. Existing optional renderer counters, loading, visibility and temporal sources remain available through the tray's host interfaces.

## Building a live panel

Import `createDiagnostics` and its types from `jank.js`. The host owns the animation loop and calls `beginFrame(at)` before instrumented work, then `endFrame(updateMs, renderMs)`. `beginFrame` returns an ID and seals the previous frame's interval. Keep scopes on the same monotonic clock. `begin()` returns a token; pair it with `end(token)` in `finally` when host work can throw.

`monitor.snapshot()` returns detached data:

- `frames`: intervals, stable IDs, scopes, coverage and overhead.
- `systems`: cumulative timing summaries and current provider values.
- `events`: the bounded marker history.
- `budget`: target FPS and milliseconds per frame.
- `capture`: mode, state, trigger ID, window, threshold and remaining post-trigger frames.
- `recording`, `recordedFrames`, `overhead`: controls and live cost information.

Use these actions for labelled buttons, fields and selectors:

| UI action               | API                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| Expand/collapse         | `setExpanded(boolean)`                                              |
| Record/stop             | `startRecording()`, `stopRecording()`                               |
| Enable spike capture    | `armCapture({thresholdMs, beforeFrames, afterFrames, cooldownMs})`  |
| Disable future triggers | `disarmCapture()`; an active post-trigger window finishes           |
| Frame budget            | `setTargetFps(fps)`; valid range 1–1000                             |
| DevTools tracks         | `setDevToolsEnabled(boolean)`                                       |
| Clear                   | `clear()`                                                           |
| Export                  | `serializeRecording(monitor.export())`; show validation/size errors |
| Remove                  | `dispose()`; also dispose the view and registered channels          |

A new view should refresh its DOM at a controlled rate (the jank.js panel uses 100 ms, 250 ms on one line or when its own refresh averages over 0.25 ms), while the host continues recording every frame. Measure the synchronous rendering callback with `monitor.measureRefresh(() => renderPanel())`. It subtracts collection already measured inside that callback. Do not nest this measurement or wrap the existing tray's measured refresh. `recordOverhead("refresh", ms)` is available when the view already measures its own exclusive cost.

Freeze is a presentation choice: retain a detached snapshot and continue collecting. A stopped recording remains available until clear, a new manual recording, or the next eligible automatic trigger. The next trigger replaces the last automatic window, so disarm to preserve it indefinitely. Hidden-tab intervals are retained as wall-clock intervals; the host can choose a different visibility policy.

## Building a recording viewer

```js
import { createRecordingViewModel } from "jank.js";
const view = createRecordingViewModel();
view.load(await file.text());
let state = view.snapshot();
if (state?.frameIds.length) {
  view.selectFrame(state.frameIds[0]);
  view.step(1);
}
view.setRange(100, 500);
state = view.snapshot(240); // Up to 240 timeline buckets; 1–1000 supported.
```

An empty model returns null. A failed load throws without replacing the previous recording. Each state is detached. Selection uses frame IDs, not array offsets. Timeline buckets retain the peak frame ID and mean/maximum interval so narrow views do not hide spikes. Ranges are in recording-relative milliseconds; the recording summary still describes the full recording.

`state.selected` contains the frame, inclusive system timings, tracked/unattributed interval, explanation, frame-local events, preceding periodic counters with their age, explicitly linked GPU results, and budget exceedance. `state.unlinkedGpuSamples` counts samples without a matching recorded frame; do not attach these to a nearby frame based on arrival time.

The jank.js viewer is `src/viewer/entry.ts` with `src/viewer/viewer.css`; it draws from per-frame lanes built once on load in `src/viewer/lanes.ts` and reads the recording through the model in `src/viewer/model.ts` (`recording()` returns a detached copy). The live panel is `src/performance/tray.ts`.

## Required presentation states

Preserve empty/loading/import-error states, recording/armed/cooldown state, an invalid budget field, unavailable/partial scope attribution, dropped scopes, absent or stale periodic counters, and GPU unsupported/pending/disabled/error/ready states. Show unknown timer resolution as unknown. Imported version 1 data lacks exact attribution, environment and overhead evidence; zero-valued placeholders must not be shown as measured zero cost.

Nested systems are inclusive: a parent and child can both report the same time. Their sum is not total CPU work. A truncated frame's unattributed remainder includes omitted instrumentation. Async GPU values can arrive frames later, and the Three adapter reports a render-pass sum, not queue span.

Recordings contain host-provided strings. Render them as text, never as HTML. The existing viewer includes a literal-markup import test. Offer files/drop targets and labelled controls; JSON remains an import/export format.

## Limits

See [measurements](measurements.md) for capacity limits and [performance](performance.md) for measured costs. Import/export is capped at 32 MiB; a dense or long capture can reach that before the frame-count cap. The panel refuses an invalid/oversized export and keeps the recording. Use shorter recordings or a lower `maxScopesPerFrame` for unusually dense instrumentation.

Recording schema version 2 is independent of the package version. No broad WebGPU support, full tracing replacement or automatic cross-machine performance comparison is promised.
