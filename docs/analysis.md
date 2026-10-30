# Recording analysis

`inspectFrame(recording, frameId)` accepts a validated recording and returns a detached CPU
frame summary, or null when that stable frame ID is absent. It needs no browser, live profiler
or clock. It does not mutate the recording.

Frame budget classification reuses the live statistics policy: target budget plus two timer
ticks, using the recorded timer resolution when available and an interval-step estimate
otherwise. The summary exposes the nominal budget, comparison limit and estimated tick.
This estimate is not clock calibration.

Attributed time is the union of recorded scopes. Overlapping and nested scopes count once;
host CPU totals and instrumentation overhead are not added to that union. Unattributed frame
interval includes waiting and scheduling, not just uninstrumented CPU execution. Missing scope
collection produces null attribution. Complete frames without scopes produce measured zero.
Truncated frames retain observed attribution and expose their omitted-scope count; their
unattributed remainder includes omitted instrumentation.

The `likelyCause` hint compares each channel's union duration against its upper median across
complete frames in the recording, including the selected frame. Absence in a complete frame
counts as zero; incomplete frames are excluded. The greatest rise above 0.05ms wins, with ties
resolved in channel registration order. Incomplete selected frames have no hint. This preserves
the reference viewer's heuristic and noise floor, but does not establish causation.

Behavioral tests cover frame identity, interval unions, detached output, missing and partial
coverage, timer tolerance, medians, overlapping same-channel scopes and tie breaking. The
isolated package consumer exercises the exported function and declarations without workspace
source files. This slice does not implement the viewer UI, GPU lanes or browser handoff.
