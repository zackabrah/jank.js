# Rewrite sequence and acceptance criteria

## Baseline and feature inventory

The existing checkout is the reference application. Do not modify it to make the rewrite pass.
Before replacing a feature, capture its visible behavior using the reference's deterministic
fixtures, screenshots and user manual. Old implementation details are not requirements.

| Capability to retain                                                                        | New owner                             | Evidence before replacement is accepted                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Frame pacing, CPU scopes/counters/events, timer-aware budget, honest overhead               | `core`, `analysis`                    | Deterministic clocks; interval-union and frame-boundary tests; recorded host workload                             |
| Manual recording, recent history, automatic before/after capture, cooldown, saved captures  | `recordings`                          | Transition table tests; capacity/clear/disarm/final-open-frame cases                                              |
| Versioned, validated local files; export capture and whole recording                        | `recordings`, browser file UI         | Round trips; malformed/oversized/fuzz input; no mutation on failure                                               |
| Loading runs, overlapping stages, cold baseline, cache/byte counters, retained sessions     | `loading`, panel loading view         | Overlap tests; rejected/cancelled operations; stale completion after replacement                                  |
| Three renderer counters, pinned Three WebGPU and WebGL2 GPU timing                          | Optional `adapters`                   | Structural compatibility; lost context/disjoint/pending/dispose/stale sample tests; real GPU limitations reported |
| Visibility, instance stats, temporal controls, bounded debug bounds overlay                 | Optional sources and panel/overlay    | Labelled controls, bounded geometry; projection convention and resource ownership tests                           |
| LINE/MINI/FULL, corners, remembered mode, LIVE/LOADING/CAPTURE tabs, freeze, clear, exports | `panel`                               | Existing dimensions and appearance; keyboard/axe; host-style isolation; repeat dispose                            |
| Offline session strip, lanes, pointer/keyboard navigation, captures, inspector, frame copy  | `viewer`, `analysis`, charts          | Hosted/offline tests; first-load pointer accuracy; invalid import keeps current view                              |
| DevTools traces, viewer handoff, clipboard/download/storage failure states                  | Browser integration and trace adapter | Entry cleanup; source/origin validation; no network; useful failure feedback                                      |
| Theme, native controls, focus/disabled behavior, component gallery                          | `junkui`                              | Independent gallery and package build; keyboard/contrast; no jank imports                                         |
| Package exports, optional adapters, self-contained viewer, zero runtime dependencies        | Build and packaging                   | Isolated consumer install; type declarations; no private assets; browser-free import                              |

Old recording versions and the old programming API are explicitly not compatibility requirements.
Preserving visible features does not mean silently interpreting old files as the new schema.

## Implementation slices

Each slice ends in a focused verified commit before the next starts. Keep the old checkout
available until the complete parity matrix and release checks pass.

1. **Complete: foundations.** Clean workspace, packages, tooling policy, architecture and
   type contracts. Validate the policy with real tool invocations and compile consumer examples.
   No runtime completeness is claimed.
2. **Complete: one internal measurement path.** Host frame boundary → channel scope → bounded history → snapshot.
   Implement the model with deterministic tests, clear/dispose behavior and measured collection
   overhead. Resolve API friction using a tiny real host fixture before adding optional sources.
   Implemented and verified using TDD; see [collection evidence](collection.md).
3. **Complete: capture, files and public profiler.** State machine, detached archive, schema
   validator, serializer and `createProfiler` composition are implemented with TDD. Property
   tests, isolated runtime/type consumers and real browser downloads verify the path. Defaults
   remain in the policy owner. Counter/error retention, event/GPU ownership and borrowed tracing
   are covered; see [recording evidence](recordings.md).
4. **Complete: junkui foundation.** Independent neutral tokens, scoped native controls and
   accessible horizontal tabs are implemented. The gallery verifies keyboard/focus behavior,
   disposal, host-style interference, axe results and desktop/narrow visual baselines in three
   engines. The built package exposes JavaScript, declarations and standalone CSS without
   profiler imports or runtime dependencies. See [UI evidence](junkui.md).
5. **Core live panel implemented.** LINE, MINI and FULL, live statistics, native tabs, freeze,
   recording/export, labelled automatic capture, archive thumbnails and scope ownership now
   have browser, accessibility and visual checks. See [panel evidence](panel.md). Loading run
   detail and optional integration views remain with slice 7; viewer handoff remains with slice 6.
   New visual baselines do not constitute final reference-feature acceptance.
6. **Analysis and offline viewer, started.** Pure CPU frame inspection is implemented; see
   [analysis semantics](analysis.md). Add lanes, shared chart geometry, selection,
   navigation, import/export, and safe handoff. Verify a single HTML artifact works offline.
7. **Loading and optional integrations, partly implemented.** WebGL2 and Three r186 WebGPU
   timing were brought forward for the standalone preview. Their optional exports, delayed
   frame association and resource ownership are implemented with TDD; see [GPU evidence](gpu-adapters.md).
   Loading handles, renderer counter helpers, visibility/temporal controls and the bounded
   overlay remain pending. Keep each renderer optional and preserve limitations in the readout.
8. **Acceptance and packaging.** Complete all retained-feature tests, independent package builds,
   exports, docs, visual comparisons and overhead benchmarks. Review package size and dependency
   boundaries. Only then consider making the rewrite the primary branch or a release candidate.

The exact geometry types for the optional bounds overlay and renderer-specific factory inputs
are intentionally deferred to their slice: they need the projection/API contract in front of
the implementer. Their required features are recorded above rather than represented by fake
generic interfaces now.

## How to judge the result

The reader should find one obvious place for a behavior and one source for an invariant.
The happy path and failure path should both be visible. Adding an unrelated feature should
not require changing core types. Shared code should reduce concepts, not merely line count.

Success requires feature/visual parity, independently usable junkui, validated data boundaries,
documented lifecycle, passing browser/consumer tests and measured acceptable overhead. A large
diff, more files, stricter lint settings or a lower line count alone proves none of those.

## Investigation priorities from production runs

Before continuing the offline viewer: capture completeness and precise timestamp diagnostics
are implemented in source, with bounded retention markers and explicit GPU sampling. Named
cloud panorama/shadows, ocean FFT, reflection, bloom and temporal-resolve passes are the next
Red Skies integration slice; labels belong at those actual submission sites. Reusable A/B run
control and unified stop/finalize/export remain follow-up work. No production integration or
archived preview has been updated by these source changes.
