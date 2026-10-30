# Capture and recording files

`createProfiler` now connects collection, optional observations and capture through direct
calls. The host owns the frame loop. Each distinct boundary delivers its preceding sealed
frame to capture once, including when the browser clock repeats a timestamp. No panel is
required to record. The final open frame stays excluded until its next boundary is observed.

## Capture ownership

The capture controller owns manual/automatic windows, the ten-entry archive and one independent
scope request. Starting manual capture disarms automatic capture; an active automatic window
is saved as truncated first. Disarming a window lets it finish. Rearming during cooldown keeps
the current deadline, and arming during manual capture requires stopping that capture first.
An assembly failure retains active data for retry. Returned recordings and archive reads are
detached, including nested metadata, scopes, counters and GPU passes.

Manual capture retains up to 6,000 sealed frames. Automatic capture defaults to a threshold of
50 ms, 120 before frames, 120 after frames and a 5,000 ms cooldown. Its before-window is limited
to 599 frames and its after-window to 5,400. The recent history holds 600 frames. Clear resets
capture and observations while preserving the clock origin, active channels and monotonic IDs.

## Optional observations

Counter providers are polled at most once per 100 ms on host boundaries. Live snapshots contain
only each active provider's latest result. Recording history retains 1,200 polling rounds
across up to 64 channels: at most 76,800 individual samples. Each result contains either
`status: "ready"` with validated values or `status: "error"` with a message. Failures do not
become zero measurements. Replacement/removal during a poll and clear/dispose inside a callback
cannot retain stale results or remove a new provider through an old handle.

Events retain 200 entries; GPU history retains 6,000 samples. Dropped observations mark an
affected recording as truncated. GPU samples are copied when received. Known profiler frame
IDs select their recording frame; unknown or cleared IDs become `null` while renderer identity
is retained. Unlinked GPU observations and timestamped events/counters are selected by the
recording's time range. An update to the most recent GPU sample replaces it rather than
duplicating it. A saved archive is never patched by a later GPU completion.

Tracing is opt-in through a borrowed sink. A failed sink is disabled and reported as an event.
Disposal releases profiler-owned state and scope demand; it never disposes the host's sink or
stops the host loop. Built-in User Timing and renderer adapters belong to later slices.

## File boundary

The version 4 codec is exported from `jank.js`. `parseRecording(text)` returns either
`{ ok: true, recording }` or `{ ok: false, problem }`. Problems include a code, field path and
readable message. Version 1/2/3 files are rejected explicitly. Use their matching preview to
read them; there is no implicit migration or reinterpretation of older GPU pass sums.

Schema 4 retains `pass-sum` and `elapsed-span` duration samples for sources such as WebGL2.
Its separate `intervals` variant records application frame ID, adapter sequence, per-pass
renderer frame IDs, stable IDs, labels, types, optional categories and invocation numbers.
Repeated IDs remain separate invocations. A GPU clock ID and decimal uint64 nanosecond origin
identify the clock; integer pass offsets preserve nanosecond precision without converting a
large absolute timestamp to a JavaScript number. They are unrelated to the CPU clock.

Render sum, compute sum, combined sum, interval-union busy time and first-to-last elapsed span
are distinct metrics. Readers recompute and verify these values. An incomplete frame retains
its available intervals, omission count and reasons, but has `metrics: null`. No partial sum is
presented as a complete frame total. Empty, explicitly measured frames can have zero totals.
Each sample allows 256 passes within a 60-second GPU interval; a recording and observation
history retain at most 16,384 GPU passes overall. Eviction marks affected captures truncated.
Out-of-order samples are retained once and cannot move the live interval sample backwards.

`serializeRecording(recording)` validates and copies the input before encoding it. Invalid
caller data throws `RecordingError`, retaining the original recording. Unknown object fields
are discarded. Counter keys are own data properties, including names such as `__proto__`.

Both directions enforce a 32 MiB UTF-8 limit. Import checks bytes before parsing JSON. Readers
also bound collections and strings, require finite measurements and safe integer IDs, validate
frame order and scope bounds, and reject dangling channel/frame references. Timestamped
observations must fall inside the recorded time range. Metadata timestamps use canonical ISO
UTC strings. Missing measurements remain explicit `null` values.

An automatic capture must contain its trigger and the trigger must exceed its threshold.
Complete captures contain the requested before/after window; truncated captures can contain
less, never more. Manual and recent recordings may be empty. The final open frame is excluded.

The codec remains independent of browser globals, filesystem access, scheduling and capture
state. Shared collection limits belong to the core; recording-specific limits belong to the
recording package.

## Test-driven verification and measurement

Behavioral tests preceded the codec, capture controller and public composition. Regression
tests reproduced stale channel disposal, host mutation of channel options, callback-driven
clear/dispose, and premature counter eviction across multiple providers before their fixes.
Tests cover round trips, malformed values/references, multibyte size cases, 200 seeded arbitrary
JSON inputs, capture transitions, capacity, ownership and failures.

`pnpm test:package` builds and runs an isolated public profiler consumer without workspace
source files or runtime dependencies. Chromium, Firefox and WebKit exercise a real host loop
and download a recording that is parsed outside the browser. They also verify clear/ID
continuity and that disposing the profiler leaves the host loop running.

The [public profiler benchmark](verification/capture.json) uses three warm-ups followed by
15 paired samples of 5,000 host frames, alternating instrumentation order. It measures frames,
scopes, periodic snapshots, manual capture, validated serialization and 64 counter providers.
Capture cases include start/stop and archive assembly. Serialization cost is amortized across
the entire batch, not reported as export latency.

Results are local Node batch averages with synthetic frame time and a real cost clock. They
include synchronous copying and garbage-collection noise, exclude browser layout/paint/GPU,
adapters and final UI, and do not compare against the old implementation. Min/max are batch
means, not frame-tail latency. The panel, viewer, loading runtime and integrations remain pending.
