# Measurements and limits

| Value                         | Meaning                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FPS                           | 1000 / mean interval of the latest 120 retained frames. Browser scheduling and display refresh affect it.                                                                           |
| Frame time / p95              | Mean and sorted 95th-percentile interval. Not CPU or GPU utilization.                                                                                                               |
| Frame graph / budget          | Latest 600 intervals, compared with `1000 / targetFps`. The target is configurable; it does not change the application's frame rate.                                                |
| Update / render submission    | Host-supplied CPU wall-clock durations. Submission completion does not mean GPU completion.                                                                                         |
| Named system                  | Inclusive union of that system's scopes in a frame. Overlapping systems must not be added together.                                                                                 |
| Tracked interval              | Union of all retained scopes, so nested/overlapping scopes count once.                                                                                                              |
| Unattributed interval         | Frame interval minus tracked union. May include waiting, browser work, scheduling, omitted instrumentation or idle time; it is not automatically uninstrumented CPU work.           |
| Collection / refresh overhead | Synchronous collector and exclusive view work. Nested collection is subtracted from refresh; deferred browser layout/paint, GPU execution and unmeasured custom views are excluded. |
| GPU pass / queue span         | Optional asynchronous host timestamps. Queue span can include gaps. The Three r186 adapter reports only the sum of render-pass durations, with queue span null.                     |
| Renderer counters             | Application-defined values. Geometry/texture counts are not memory sizes; allocation estimates are not total device VRAM.                                                           |
| Loading elapsed / combined    | Union of overlapping stage operations versus sum of operation durations. Includes asynchronous waits; stages need not be additive.                                                  |

## Capture semantics

Explicit `beginFrame(at)` seals the preceding interval and opens a new stable frame ID. `endFrame` attaches CPU durations. The final pending frame is not fabricated on export or stop. Repeated coarse timestamps share one interval and accumulate CPU durations; no zero-length frame is invented. A decreasing timestamp is rejected as a clock mismatch. Scopes crossing boundaries are clipped into each frame. Missing scopes, disposed unfinished scopes and capacity truncation are indicated by coverage and dropped counts. Legacy `frame()` remains supported with exact attribution unavailable.

Detailed timers run while expanded, recording, armed or emitting DevTools entries. Collapsed monitoring otherwise retains supplied pacing and CPU durations. Frames where detailed collection was inactive for any part of the interval have unavailable attribution. Browser suspension can create a large scheduling interval; the host owns whether to omit it.

Manual recording stops at 6,000 frames. Automatic capture defaults to a threshold of twice the configured budget, 120 preceding frames, the trigger, 120 following frames and a 5,000 ms cooldown. The configured threshold is fixed when armed; re-arm after a budget change to use a new default. The panel does this when its budget changes, and AUTO CAPTURE re-arms with the edited window. The panel also keeps up to ten completed automatic captures in memory; the monitor retains only the latest. A later eligible trigger replaces the retained capture. Disarming prevents new triggers while an active post-trigger window finishes.

## Bounded histories and files

| Data                               | Limit                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Recent / recorded frames           | 600 / 6,000                                                                                  |
| Named scopes                       | Default 128 per frame; configurable 1–1,024; open scopes also bounded                        |
| Systems / provider values          | 64 systems, 64 values per system                                                             |
| Events                             | 200; labels 240 characters, details 2,000                                                    |
| Periodic recorded system snapshots | 1,200 at least 250 ms apart; counters are not exact per-frame samples                        |
| GPU                                | Core retains up to 6,000 samples; panel fallback retains 600 recent / 6,000 recorded samples |
| GPU passes in imported sample      | 256                                                                                          |
| Loading history / overlay bounds   | 8 completed runs / 128 boxes                                                                 |
| JSON import/export                 | 32 MiB                                                                                       |

Counts are bounded independently of file size. A dense recording can exceed 32 MiB before reaching the frame cap; serialization then fails clearly without deleting the retained recording. Shorten the capture or lower scope capacity. Scope overflow is marked truncated instead of silently presenting complete attribution.

Starting a recording replaces its frame/system sample window. Events and cumulative system summaries remain since Clear; the inspector filters events to the selected interval. Export uses recorded frames when available, otherwise recent frames, and includes current system summaries. Exported overhead summarizes the last up to 600 exported frames; live overhead summarizes recent frames. The budget is the selected comparison target at export time, not a history of budget setting changes.

## Format and environment

`jank.js-recording` version 2 has explicit millisecond units, stable frame IDs, coverage, per-frame overhead, capture configuration and environment metadata. `parseRecording` validates and copies untrusted files, rejecting invalid versions, non-finite/negative durations, duplicate IDs, invalid ordering and out-of-frame scopes. Version 1 files migrate with unknown environment and unavailable attribution/overhead evidence. Unknown optional extension fields are ignored by the generic viewer; the original download retains them.

Each new recording stores application and jank.js versions, creation time, browser/platform, hardware concurrency, viewport/pixel ratio and isolation status. CPU timer resolution is the smallest positive delta observed in 256 bounded clock reads at monitor initialization. It is an estimate, not a guarantee of actual precision; no observed delta yields null. A custom clock is identified as custom. GPU timer resolution remains unknown unless supplied in the recording; the adapter does not infer it from small durations.

Browser clocks may be coarsened or jittered, and isolation changes the permitted resolution. Compare recordings with their environment and timer context visible rather than assuming identical precision. See the [High Resolution Time specification](https://www.w3.org/TR/hr-time-3/).

## Browser support

Targets modern browsers with ES2023, CSS nesting and OKLCH. The local browser suite covers pinned Playwright Chromium, Firefox and WebKit on macOS: packaged-panel fixtures, controls, automatic capture, DevTools emission, recording round trips, offline files, accessibility, remounting and narrow screens.

WebGPU support is optional. The pinned Three r186 adapter was also tested with real timestamp results in headed Chromium on this machine; headless Chromium reported timestamps unavailable. Capability fallback tests are not timing validation. See [GPU evidence](verification/webgpu.json). Other renderer revisions, mobile devices, older browsers and different GPU drivers remain unverified.
