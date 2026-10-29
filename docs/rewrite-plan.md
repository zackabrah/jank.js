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
   Implemented and verified using TDD; see [collection evidence](collection.md). The public
   profiler composition is deliberately deferred until its capture controller is implemented.
3. **Capture and files.** Implement the state machine, detached archive, schema validator and
   serializer. Add property tests and isolated file-consumer checks. Keep defaults in the owner
   of the policy, not in the parser.
4. **junkui foundation.** Rebuild tokens and scoped native controls against the current look.
   Add an independent gallery and accessible tabs. Check focused interactions and host styles.
5. **The live panel.** Build LINE first, then MINI and FULL. Separate live/loading/capture views,
   their view models and local interaction state. Add real accessibility and visual checks at
   each size. Capture ownership stays outside the panel.
6. **Analysis and offline viewer.** Add pure inspection/lanes, shared chart geometry, selection,
   navigation, import/export, and safe handoff. Verify a single HTML artifact works offline.
7. **Loading and optional integrations.** Implement loading handles and adapter-specific resource
   ownership; add visibility/temporal controls and the bounded overlay. Keep each renderer
   optional and preserve limitations in the readout.
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
