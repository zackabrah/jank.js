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
   detail is implemented; optional integration views are implemented in slice 7; viewer handoff is implemented in slice 6.
   New visual baselines do not constitute final reference-feature acceptance.
6. **Analysis and offline viewer implemented; core reference audit completed.** CPU/GPU lanes,
   counter overlays, A/B inspection, navigation, captures, frame copy, nearby events and safe
   panel handoff have behavior tests. The single HTML viewer works offline with local imports;
   hosted same-origin handoff has validated messages and download fallbacks. See
   [viewer behavior](viewer.md), [analysis semantics](analysis.md) and the
   [reference audit](verification/ui-parity.md). Optional integration views and local acceptance are recorded in slices 7–8.
7. **Loading and optional integration surfaces implemented.** WebGL2 and Three r186 WebGPU
   timing were brought forward for the standalone preview. Their optional exports, delayed
   frame association and resource ownership are implemented with TDD; see [GPU evidence](gpu-adapters.md).
   [Loading runs](loading.md), overlapping stages, retained cold baseline, cache/byte observations
   and bounded session history are implemented with a real demo and panel tests. [Renderer counter helpers, visibility/instance/temporal controls and bounded overlays](renderer-diagnostics.md)
   are implemented with optional host-owned contracts, demo coverage and browser checks. Keep each renderer optional and preserve limitations in the readout.
8. **Local acceptance and packaging review completed.** Retained-feature tests, independent package
   consumers, exports, documentation, visual comparisons, dependency boundaries and overhead
   benchmarks have been reviewed. See the [acceptance report](verification/local-acceptance.md)
   for evidence and limits, including GPU skips and remaining visual differences. Packages remain
   private; production integration, primary-branch promotion and publication are separate decisions.

The bounds API explicitly declares world AABBs, a column-major world-to-clip matrix and the
clip-depth convention. Production visibility/temporal implementations remain in the host renderer;
Jank does not substitute synthetic observations for those integrations.

## How to judge the result

The reader should find one obvious place for a behavior and one source for an invariant.
The happy path and failure path should both be visible. Adding an unrelated feature should
not require changing core types. Shared code should reduce concepts, not merely line count.

Success requires feature/visual parity, independently usable junkui, validated data boundaries,
documented lifecycle, passing browser/consumer tests and measured acceptable overhead. A large
diff, more files, stricter lint settings or a lower line count alone proves none of those.

## Investigation priorities from production runs

Capture completeness, precise timestamp diagnostics, named-pass support, reusable A/B run
control and unified stop/finalize/export are implemented. The Red Skies cloud-ramp report at
`b571916` exercises installed Jank `f1662bb` with production integration `c80c2f8`, including
named cloud, reflection, ocean and post-processing passes. Its findings below now guide the
next product improvements. Production A/B adoption and finer host CPU scopes remain follow-up
work; this review does not change Red Skies or its editor.

## Product follow-up todo

- [x] Make automatic hitch capture a primary workflow: expose a clear **Capture slow frames**
  control, visible armed/disarmed status and a notice when a hitch is captured, with a direct
  path to inspect or export it. Preserve before/after context, bounded retention and truthful
  completeness reporting. Make it clear that captures remain in memory until exported.
  This is a discoverability improvement to the existing automatic capture behavior; changing
  whether it is armed by default is an open design decision.
- [x] Review the cloud-ramp user report before implementing capture UX changes. Read the updated
  report at Red Skies commit `b571916`, validate the delivered recordings and open capture 05
  in its bundled viewer. Evidence and follow-up scope are recorded below.
- [x] Add budget-relative presets alongside the absolute millisecond threshold, with the
  resolved rule and frame budget visible. Presets resolve when armed; changing the budget
  does not silently replace an active rule.
- [ ] Revisit default arming and threshold behavior after reviewing capture usefulness and
  repeated-trigger noise. The default remains disarmed at 50 ms; one workload's useful
  threshold is not universally appropriate.

### Reviewed feedback: storm transition

Source: Red Skies `docs/verification/jank-cloud-ramp-viewer-2026-10-31.md`, commit `b571916`;
Desktop bundle `red-skies-cloud-ramp-jank-f1662bb-2026-10-31.zip`. Installed Jank is
`0.2.1-rewrite.4` at `f1662bb`. The reported experiments use AC power, a 60 FPS target,
120 frames before/after, a 5,000 ms cooldown and one-in-eight GPU sampling.

- Reported 50 ms run: zero captures; storm-period median 34.8 ms, p95 41.7 ms, maximum 48.7 ms.
  This is a severe-hitch threshold missing sustained over-budget work, not evidence that a
  crossed threshold failed to trigger.
- The 25 ms run produced ten captures. Independently parsed all ten with Jank: each has 241
  sealed frames and its original trigger at position 121, exceeding 25 ms. All 50 supplied
  checksums match. The report records settled finalization with no missing correlated GPU
  records or merge omissions. Its slower overall run is not a controlled overhead comparison.
- Opened `automatic/auto-25-05.json` first in the exact bundled viewer and selected
  **Overview capture 1**: frame 7476, 27.8 ms, approximately 2.10 seconds before and 4.18 seconds
  after. The `Coverage 50%` event and following Water + buoyancy rise remain visible. Within
  this recording, independently calculated Water + buoyancy scope medians are approximately
  0.2 ms before that event and 41.6 ms after it, excluding the frame spanning the event.
  This identifies a broad CPU scope, not an individual function or a GPU cause.
- Every exact trigger is deliberately sampled out. Each file has 211 sampled-out frames,
  30 partial GPU samples with reversed reflection timestamps, zero complete GPU frames and
  zero missing correlated records. Unknown totals must stay unknown; partial pass evidence
  remains useful. Increasing sampling after detection cannot recover a skipped trigger.
- The viewer opens at the first context frame. Its current `CPU 100% · GPU 0% · TRUNCATED`
  header and long list of reflection invocations obscure these distinctions and push counters
  below the fold. Import and trigger selection produced no browser JavaScript errors.
- Frame-count windows cover different elapsed durations as FPS changes. Cooldown starts after
  post-trigger collection; it is not a fixed five-second interval between trigger frames.
- No default or runtime behavior has been changed by this review.

### Follow-up work from the report

- [x] Improve automatic-capture entry and orientation: prominent arm/status/captured feedback,
  budget-relative threshold guidance, and a prominent **Go to trigger** action or initial trigger
  selection. Preserve access to the full before/after context. LIVE entry, presets, saved-capture
  inspection, original-trigger selection and a sampled-out trigger notice are implemented.
  Sustained-over-budget triggering remains a separate follow-up from single-frame detection.
- [x] Show actual retained pre/post elapsed durations in the automatic recording inspector.
- [ ] Evaluate bounded seconds-based windows. Explain cooldown timing and archive retention/eviction. Consider
  grouping repeated captures of one episode and opt-in automatic export for longer sessions.
- [x] Separate sampled GPU frames, frames with usable timing, complete frames, valid/rejected
  timestamp pairs, omitted passes and missing observations. The trigger sampling notice remains
  explicit; partial evidence never becomes a valid whole-frame total.
- [x] Group repeated GPU invocations by stable pass ID and type in timeline and inspector.
  Preserve invocation detail, fixed first-seen order and expansion during navigation. Group
  readouts identify observed pass sums and observed-row counts; they never claim GPU busy time.
- [x] Pin important context counters above work lanes and near selected-frame evidence, retaining
  raw values, sample ages, unknown observations and A/B alignment.
- [ ] Improve numeric counter formatting and distinguish counter-only channels from CPU work
  without hiding genuinely unobserved registered CPU scopes. Explain CPU retention independently.
- [ ] Add bounded chunk export and a session manifest/timeline for long recordings. Expose GPU
  pass/sample capacity as well as CPU frame capacity; starting a new capture currently shares
  observation retention. Preserve explicit gaps and unsealed tails across chunks.
- [ ] Mark export/serialization boundaries and support explicit analysis exclusions. In the manual
  report, the worst frame is an export-boundary interval rather than the sustained CPU problem;
  exclusion must be visible and must not erase original evidence.
- [ ] Investigate reversed environment-reflection timestamps with the host integration before
  claiming complete GPU costs. Trial denser sampling for short automatic captures and measure
  its overhead with matched workloads; do not infer an instrumentation regression from these
  sequential 50 ms and 25 ms runs.
- [ ] Host follow-up: split Water + buoyancy into spectrum construction, query-field preparation
  and buoyancy integration, or use a CPU trace. Reusable ramp/preset/scrub authoring belongs in
  Junklab Engine; Red Skies owns weather parameters. Existing private hooks are evidence tools,
  not a shipped editor feature.
