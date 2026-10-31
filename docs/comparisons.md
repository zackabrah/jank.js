# Repeatable A/B comparisons

`createComparison` coordinates a bounded experiment using the application's profiler and host
frame loop. Pass the controller to `createPanel({ profiler, comparison, ... })` to enable
**CAPTURE → A/B COMPARISON**. The panel owns labelled controls for warm-up, measurement,
repeat count, Stop and Export. Application-specific A/B settings stay in the host's existing
scene/editor controls; no JSON authoring interface is required.

```ts
import { createComparison, createPanel } from "jank.js";

const comparison = createComparison({
  profiler,
  // gpuResolver: webGpuAdapter, // optional interval readback, borrowed
  host: {
    begin() {
      // Snapshot both configurations once, before changing the scene.
      const original = scene.readSettings();
      const variants = { A: readBaselineControls(), B: readCandidateControls() };
      return {
        apply(variant) {
          scene.applySettings(variants[variant]);
          scene.resetAnimation();
          return {
            label: `Scene ${variant}`,
            settings: [
              { label: "Objects", value: variants[variant].objects },
              { label: "Shadows", value: variants[variant].shadows },
            ],
            resolution: { widthPx: canvas.width, heightPx: canvas.height },
            animation: "Reset to time zero before each warm-up",
          };
        },
        check() {
          return scene.contextLost() ? "GPU context lost; restart the comparison." : null;
        },
        restore() {
          scene.applySettings(original);
        },
      };
    },
  },
});
const panel = createPanel({ container, profiler, comparison, mode: "full" });

function frame(atMs: number) {
  const frameId = profiler.beginFrame(atMs); // seals the preceding frame
  comparison.tick(atMs, frameId); // applies changes before this frame's application work
  // Run the existing host update/render, endFrame CPU totals, and observeGpu calls.
  panel.refresh(atMs);
}
```

The scene methods above stand for host-owned operations. `begin` must either return a restoration
handle or fail without modifying host state. `apply` is synchronous and runs at a frame boundary;
include shader compilation/asset readiness in warm-up or prepare assets before starting. `check`
is an optional lightweight host invariant check (viewport, GPU source, context, etc.). Restore
runs exactly once after completion, cancellation or application failure; failures are reported.
Lock scene/editor settings during the run and restore their original enabled states afterward.
The basic demo shows this integration, including actual drawing-buffer resolution and animation
reset/restoration. Existing demo fields are sufficient for authoring the two scene variants.

The controller does not schedule frames or own the profiler/renderer. Call `tick` exactly once
immediately after each `beginFrame`, using its timestamp and returned ID, even when the panel is
collapsed. CPU totals come from `endFrame`; scopes cannot substitute for missing host totals.
The host should dispose the comparison before disposing its profiler. A detached panel cancels
the active comparison and restores the host, but does not dispose the borrowed controller.

## Windows, retention and lifecycle

Defaults: three pairs, one-second warm-up, two-second measurement. Controls allow 2–6 pairs,
0.5–10 seconds warm-up and 1–10 seconds measurement. The order alternates AB, BA, AB. Each trial
has a 500 ms host-driven GPU drain; an optional interval resolver then gets a bounded two-second
wait outside the host callback. Normal host collection/rendering continues during both stages.

Jank uses its existing manual capture path and 6,000-frame limit. It requires idle capture before
starting; the panel locks recording/export, automatic arming, GPU/trace and budget actions during
comparison. CLEAR, Stop, hiding the document or closing the panel cancel the run. Host invariant
failure, invalid/backward clock, capture interruption/capacity and a generous overall elapsed
limit also cancel it. Budget changes are checked at stage boundaries. Do not manipulate capture
state from another controller while a comparison owns it.

Warm-up frames, drain frames and a frame crossing the requested measurement deadline are excluded
from each trial's exported recording. The last open host frame is never manufactured. The normal
capture archive retains its raw measured-plus-drain windows (and has its usual ten-entry limit);
the comparison retains its own trimmed, finalized copies of all completed trials, up to twelve.
Exported metadata preserves each trial's actual scene settings, drawing resolution and animation
state. Context is bounded to 32 settings, 256-character strings and finite numeric values.

Only completed trials survive cancellation. A cancelled run never presents aggregate comparisons.
Late resolver completion cannot enter a newer run or undo cancellation. Starting another run
replaces the controller's previous report; closing the panel alone retains it. Combined retained
trial data is bounded below 32 MiB with space reserved for summary metadata. Hitting that limit
cancels the incomplete trial. Export enforces a 32 MiB UTF-8 file limit and validates each nested
recording. No data is uploaded.

## Reading results

Each trial reports CPU, GPU and frame-pacing median, floor-rank p95, over-budget percentage and
sample counts. It also reports measured-window coverage, CPU/GPU sample coverage, interval
coverage/loss reasons, truncation and finalization status. A metric needs at least 20 valid samples,
80% of the requested time window in sealed frames, and 80% valid CPU/GPU samples as applicable.
Unknown data remains null. Duration-only WebGL samples can establish duration sample coverage;
they cannot establish WebGPU interval coverage. GPU totals from multiple observations of the same
frame are excluded as ambiguous. Busy interval time, pass sums and elapsed spans are distinct;
Jank withholds a GPU comparison when those measurement types differ across trials.

Summary values are medians of per-trial medians/p95s, with equal trial weight. Differences are
computed within each pair before taking their median; this paired difference need not equal the
difference of the two displayed marginal medians. The p95 paired range shows variation. Negative
B − A means lower measured time. A range crossing zero shows mixed results. Budget percentages
are compared in percentage points. No winner, confidence interval or statistical significance is
claimed. CPU/GPU use the exact current Jank budget; frame pacing allows 1 ms or 5%, whichever is
larger. CPU and GPU overlap, and host CPU totals exclude browser layout/paint and GPU execution.

**Export comparison** downloads `jank.js-comparison` version 1: options, captured budget, status,
summary, trial metadata and every completed A/B recording in one JSON file. This is a comparison
bundle accepted by the [offline viewer](viewer.md), which recalculates results and lets you inspect
and export individual trials. Each `trials[i].recording` remains a normal schema-5 recording.
Programmatic callers can use `comparison.report()`, `serializeComparison(report)` and
`parseComparison(json)`; snapshots/reports are detached from retained state. Import/export validate
authoritative trial fields and recompute derived summaries rather than trusting stored metrics.
