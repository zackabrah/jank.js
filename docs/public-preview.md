# Public preview compatibility and limits

This source branch is available for evaluation and contributions. The current package version
is `0.2.1-rewrite.6`; build footers and recording metadata also identify the source revision.
The `private: true` package flags prevent registry publication; they do not restrict the MIT
license or use of locally built archives. There is no new npm release from this branch.

## Compatibility

| Surface             | Preview contract                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript API      | ESM and TypeScript declarations. The rewrite is not a drop-in replacement for the previous API; use the integration guide. Breaking preview changes are possible.               |
| Recordings          | Reads recording schemas 5, 6 and 7. Ordinary captures write 5, spike episodes 6 and sustained captures 7. Schemas 1–4 are rejected; no migration tool is supplied.              |
| Comparisons         | Reads and writes comparison format 1. Keep the matching viewer with exported files.                                                                                             |
| Browser UI          | Modern browsers; interaction/accessibility tests run in Chromium, Firefox and WebKit. No legacy-browser support claim.                                                          |
| WebGL GPU timing    | Optional WebGL2 timer queries; availability is device/browser dependent. Disjoint or unavailable results remain unknown.                                                        |
| Three WebGPU timing | Adapter targets Three r186 and is tested against 0.186.1. Other Three versions are not validated. Requires timestamp-query support; WebGPU generally requires a secure context. |
| Renderer ownership  | Host owns its renderer, loop and optional sources. GPU adapters are opt-in; Jank does not discover or instrument arbitrary page rendering.                                      |
| Development         | Node 24.22.1, pnpm 11.24.0 and the lockfile's exact dependencies. Visual baselines use macOS 26 arm64.                                                                          |

## Measurement limits

Frame duration describes the interval between host frame boundaries. CPU scopes measure host
work on the CPU clock; GPU observations use a separate clock and may arrive later. Pass sums,
interval-union busy time and elapsed span answer different questions. Incomplete GPU frames
have no whole-frame total. Missing, sampled-out, pending and rejected observations must not be
interpreted as zero or ranked as complete work.

The native WebGPU diagnostic reproduces an invalid timestamp pattern on one tested browser/GPU
combination, including clear-only passes. A tested application-specific PMREM workaround is
recorded in [the investigation](verification/gpu-diagnostic-2026-11-01.md); it is not a generic
Jank fix or a guarantee of reliable scene timing. The probe does not calibrate all positive
intervals. Report raw endpoints and rejection reasons when investigating GPU issues.

Profiler overhead readouts cover synchronous collection/refresh, not deferred layout, paint or
GPU work. Demo headroom estimates are workload-specific. A/B summaries require matched context
and adequate samples; they are not proof of statistical significance or hardware rankings.

## Capture and persistence

Default recent history retains 600 frames; manual captures are capped at 6,000 frames; the
archive retains ten completed captures. Other observation capacities are separately bounded.
Before-context may be incomplete and pending GPU work may exceed the finalization timeout.
Inspect exported completeness and sampling evidence rather than assuming every frame has GPU data.

Automatic capture starts **disarmed**, with a default single-frame threshold of **50 ms**.
Budget-relative presets, sustained-over-budget triggers and seconds-based slowdown episodes
are available explicitly. Changing the budget does not silently replace an armed spike rule.
Freezing the panel freezes presentation while collection continues.

Captures stay in memory until exported. Closing/reloading the application loses unexported
captures; archive eviction also removes older captures. Automatic file saving, bounded chunk
export and a multi-chunk session timeline are not implemented. Export/serialization boundaries
are not yet automatically excluded from analysis. Files may contain host-provided labels,
counters, events and environment metadata; review them before attaching to a public issue.

## Public evidence and next work

Tracked screenshots are UI test fixtures; benchmark reports are synthetic or explicitly described
local experiments. Application-specific notes explain the origin of observed failures but do not
ship private scenes, application assets or full production recordings. References to external
application commits are context, not build prerequisites or generic performance claims.

Remaining product work includes long-session exports, explicit analysis exclusions, counter-only
channel presentation, evaluation of capture defaults, broader GPU/device validation and the UI/UX
review. Production integration and a stable API/registry release remain separate milestones.
See [the roadmap](rewrite-plan.md), [usage](../packages/jank/docs/USAGE.md) and
[integration](../packages/jank/docs/INTEGRATION.md) for details.
