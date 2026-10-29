# Recording files

The version 3 codec is implemented and exported from `jank.js`. `parseRecording(text)` returns
either `{ ok: true, recording }` or `{ ok: false, problem }`. Problems include a code, a field
path and a readable message. Version 1/2 files are rejected explicitly.

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

The internal capture controller is implemented separately. It consumes each sealed frame once,
owns manual/automatic windows and the ten-entry archive, and holds one independent scope
request. Its recent-frame and recording-assembly inputs are explicit callbacks supplied by the
profiler composition. An assembly failure retains active data for retry. Disarming an active
automatic window lets it finish; arming during manual capture requires stopping that capture
first. Rearming during cooldown preserves the current deadline. Public composition is next.

Verification includes round trips, malformed values and references, multibyte size cases,
200 seeded arbitrary-JSON inputs, and an isolated built-package consumer. This stage has
45 codec tests, 17 controller tests, two copy-isolation cases and 28 collector tests. Existing browser host-loop tests pass in
Chromium, Firefox and WebKit. A collection benchmark was also rerun after sharing limit
definitions; its local Node batch averages are not a browser or old-version speed comparison.
