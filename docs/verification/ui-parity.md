# UI reference audit · 31 October 2026

The interactive [comparison harness](../../examples/parity/README.md) puts the original built
package on the left and this rewrite on the right. It supports the offline viewer and
FULL/MINI/LINE panels, desktop and 390px viewports, and equal-scale or native-size inspection.
Both viewers open the same spike (#243). The original remains read-only.

Reference: built version 0.2.1, commit `eeed4c797a6bf71b92e4362bb5abf744bae36f06`, with its
build metadata marked dirty. This identifies a local build, not a clean release artifact.
The samples share synthetic frame boundaries, scopes, events and scripted GPU observations;
they are not benchmark measurements or evidence of adapter performance.

## Findings and fixes

| Area                  | Finding and evidence                                                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel geometry        | Native FULL and LINE widths are 360px and MINI is 240px in both builds. Side-by-side review retains the dark monospace theme, orange missed-frame cues, graph annotations and FPS readouts. Typography weight, control labels and disclosure layout still differ; this is not a pixel-identical replacement. |
| Viewer structure      | Session strip, frame timeline, CPU/GPU lanes, captures and right inspector are present. Desktop and narrow screenshots cover single recordings and A/B overlays.                                                                                                                                             |
| Navigation            | Restored dragging the session range, Shift+arrow ten-frame steps, and bracket capture cycling. Browser regressions cover selection preservation, pointer release, keyboard focus and editable-field protection.                                                                                              |
| Frame context         | Restored unattributed-time and synchronous profiler-overhead lanes and compact inspector rows. Overhead graph height is amplified ×20; reported milliseconds remain actual values.                                                                                                                           |
| Inspector cues        | Restored dotted label leaders and likely-scope emphasis. The attribution remains a heuristic, not a causal claim.                                                                                                                                                                                            |
| Retained interactions | Viewer browser suites cover imports, captures, exports, copy, nearby events, counters, A/B navigation, handoff and accessibility. Existing panel tests cover modes, freeze, graph navigation, collapsible sections, recording and exports.                                                                   |

## Differences to preserve or review

- GPU gaps remain unknown; old samples are not silently reused as current measurements.
- Configured work rows retain their order and missing observations remain visible. Added
  frame-context rows follow GPU lanes so existing work positions stay stable.
- Unattributed time is the frame interval minus the union of CPU scopes. It includes waiting
  and unobserved work, not measured idle time. Missing scope collection yields unknown;
  truncated collection prevents a misleading A/B difference.
- Profiler overhead covers synchronous collection and refresh only. It may overlap scopes
  and excludes deferred layout, paint and GPU work.
- Session dragging preserves the selected frame. Home/End navigate the whole recording.
- The rewrite adds explicit coverage, A/B overlays, counter ages and disclosure controls.
  These consume space and can move captures below the fold; the timeline area scrolls.
- Live panel scope averages use the visible graph window. Different windows can produce
  different averages from the original even with identical input observations.

## Verification

The restored behavior has failing-before-fix regressions and passing implementation tests.
`pnpm check` passes (297 unit tests), as do `pnpm test:package` and `pnpm test:coverage`
(98.19% statements, 95.78% branches). All 159 viewer browser cases pass across Chromium,
Firefox and WebKit, including visual and accessibility checks. Updated visual baselines were
reviewed at desktop and narrow widths and rerun without snapshot updates. A counter-hover
test now scrolls its target into view after the additional context lanes increased page height.
No collection algorithm or GPU adapter changed; no new performance claim is made.

## Remaining acceptance work

This completes the current core panel/viewer audit, not acceptance of the entire rewrite.
Loading run ownership/history/overlap/cache measurements, optional renderer counter helpers,
visibility and instance diagnostics, temporal controls and the bounded debug overlay remain
pending in [slice 7](../rewrite-plan.md). Production Red Skies pass labels and adoption of
capture/comparison workflows also remain integration work. Final package/release acceptance
must follow those slices and another visual review of their actual interfaces.
