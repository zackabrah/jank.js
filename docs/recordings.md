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
stops the host loop. Built-in User Timing remains pending; renderer adapters are optional.

## Bounded GPU finalization

`capture.stop()` remains synchronous and seals only already-completed CPU frames. To collect
pending WebGPU results, call the exported `finalizeRecording` outside your animation callback:

```js
import { finalizeRecording, serializeRecording } from "jank.js";

async function stopAndExport() {
  const stopped = profiler.capture.stop();
  if (!stopped) return;
  const finished = await finalizeRecording(stopped, gpu, { timeoutMs: 2000 });
  // Inspect finished.status and finished.complete in your own labelled capture UI.
  const json = serializeRecording(finished.recording);
  // Save json through your application's existing export action.
}
```

The host loop continues while this promise waits. Close GPU brackets before finalizing. The
operation asks only for the recording's sealed frame IDs and returns a detached recording.
It merges all available requested intervals by clock/sequence, preserves existing complete
observations and ignores unrelated/future/unassociated additions. It never invents the final
open CPU frame. The original recording and archive entry remain unchanged: export the returned
`finished.recording`, not the original archive entry. Panel STOP/EXPORT retain their synchronous
behavior; hosts that need drained captures use this API.

`status` is `settled`, `timeout`, `cancelled`, `unavailable` or `error`. `complete` means every
recorded CPU frame has complete interval data and no merge samples were omitted; it is separate
from whether the drain settled. `missingFrameIds`, `incompleteFrameIds`, `omittedSamples` and
`error` explain gaps. WebGL2 duration samples are preserved but do not satisfy interval coverage.
The helper has its own 0–10,000ms timeout (default 2s), so even a resolver that never settles
cannot hold the operation indefinitely. JavaScript timers remain subject to event-loop delays.
Late resolver completion cannot mutate the returned capture.

Existing observations take priority at the 6,000-sample / 16,384-pass merge limit. Capacity
omissions, missing interval frames or partial frames mark the returned recording `truncated`.
Resolver errors retain the stopped observations and return an error description. Caller input
and timeout options are validated before waiting; invalid caller recordings throw. The adapter
retains 128 resolved frames, so finalize promptly and keep `onSample` connected during capture.

The operation status is returned to the caller, not serialized as timing data. Exported files
retain each observed frame's completeness/reasons and the recording's truncation flag; absent
GPU samples remain absent, never zero. The helper does not modify legacy pass-sum semantics.

## File boundary

The version 5/6 codec is exported from `jank.js`. `parseRecording(text)` returns either
`{ ok: true, recording }` or `{ ok: false, problem }`. Problems include a code, field path and
readable message. Version 1/2/3/4 files are rejected explicitly. Use their matching preview to
read them; there is no implicit migration or reinterpretation of older GPU pass sums.

Schema 5 retains `pass-sum` and `elapsed-span` duration samples for sources such as WebGL2.
Its separate `intervals` variant records application frame ID, adapter sequence, per-pass
renderer frame IDs, stable IDs, labels, types, optional categories and invocation numbers.
Repeated IDs remain separate invocations. A GPU clock ID and decimal uint64 nanosecond origin
identify the clock; integer pass offsets preserve nanosecond precision without converting a
large absolute timestamp to a JavaScript number. They are unrelated to the CPU clock.

Render sum, compute sum, combined sum, interval-union busy time and first-to-last elapsed span
are distinct metrics. Readers recompute and verify these values. An incomplete frame retains
its available intervals, omission count and reasons, but has `metrics: null`. No partial sum is
presented as a complete frame total. Empty, explicitly measured frames can have zero totals.
Each sample allows 256 accepted/rejected pass records within a 60-second GPU interval; a recording and observation
history retain at most 16,384 accepted/rejected GPU pass records overall. Eviction marks affected captures truncated.
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


## Time-based slowdown episodes (schema 6)

Frame-count mode remains the default. Set `timeWindow` when arming to opt into one bounded
slowdown episode. Its before window uses elapsed time and includes whole overlapping frames
from the existing 599-frame prehistory; unavailable time or gaps mark the recording truncated.
Repeated sealed frames exceeding `thresholdMs` join the same episode and extend its quiet
recovery deadline. Collection ends after both the minimum post-trigger duration and a continuous
interval without further threshold crossings. Quiet means below the trigger threshold, not
necessarily within the frame budget. Limits end the episode even if the slowdown continues.

```ts
profiler.capture.arm({
  thresholdMs: 25,
  beforeFrames: 0, // ignored when timeWindow is supplied
  afterFrames: 0,
  cooldownMs: 5000,
  timeWindow: { beforeMs: 2000, afterMs: 4000, recoveryMs: 2000, maxDurationMs: 30000 },
});
```

Windows are finite 0–600,000 ms. The duration limit must be positive and at least the post-trigger
and recovery windows. It starts at the first trigger's end, excludes prehistory, and is also
bounded by 6,000 total retained frames. Only sealed frames are considered, so one frame may
cross a time boundary; stalled hosts cannot finalize until another boundary arrives. No new
clock, timer or host-loop ownership is introduced. Cooldown starts when the episode ends.
Disarming freezes further extension but retains the current tail and its threshold crossings.
Rearming changes the next episode's settings. Manual start interrupts and truncates an episode.
Clear/dispose discard active collection; failed assembly retries the same closing boundary.

Schema 6 adds `capture.episode`: requested time settings, cooldown, every retained threshold
crossing in order, and a stop reason (`recovered`, `disarmed`, `frame-capacity`, `duration-limit`,
or `manual-start`). Its before/after frame counts describe the retained frames, rather than a
requested frame window. Non-episode captures still write schema 5. Both schemas import; schema 5
cannot silently accept episode fields. Copies and exports detach nested settings and trigger IDs.
Existing recording metadata, observations and completeness diagnostics accompany the whole episode.
GPU/counter/event retention pools remain independently bounded; time windows do not guarantee
complete GPU samples. At a limit, the episode is truncated and a later trigger after cooldown
can start a new episode. Archives still evict the oldest capture after ten entries.
