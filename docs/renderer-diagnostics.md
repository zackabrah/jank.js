# Optional renderer diagnostics

All adapters remain optional and dependency-free at runtime. The host owns its renderer,
frame loop, visibility decisions, temporal pipeline and counters. Jank reads observations and
routes labelled controls; removing a panel does not reset or dispose these host resources.

## Renderer counters

```ts
import { readThreeRendererCounters } from "jank.js/adapters/three-counters";
const channel = profiler.createChannel({
  id: "renderer",
  label: "Three renderer",
  readCounters: () => readThreeRendererCounters(renderer.info, "webgl"),
});
```

Use `"webgpu"` for Three's WebGPU backend. This reads `render.drawCalls`; WebGL uses
`render.calls`. WebGPU's cumulative `render.calls` is not a draw count. The helper returns
draw calls, triangles, points, lines, geometry count and texture count; absent, negative or
nonfinite values are null, while measured zero remains zero. Geometry/texture counts are
resource counts, not bytes. Submitted primitive counts are upper bounds when GPU culling is
active, not evidence of executed shader work.

The helper never changes `autoReset` or calls `reset()`. Arrange the host loop so counters
are polled before their next reset; the basic demo polls the previous completed render at
`beginFrame`, then resets before the next render. Multiple passes require a host-owned reset
policy. Structural compatibility was checked against the pinned Three r186 implementations;
no untested renderer version is claimed.

## Visibility, instances and temporal controls

Supply `visibility` and/or `temporal` to `createPanel`. Their interfaces are exported from
`jank.js`. They return snapshots through `read()` and expose setters for controls. Returning
null means unavailable; throwing reports the source error without displaying stale values.
The optional snapshot `note` explains host-specific limitations.

The panel shows tested/visible/culled counts per named view, optional distance culls,
instance hierarchy/node/preparation/cache counts, candidates/visible/culled/rejected leaves,
and sample age. Unknown age remains unknown. View rows retain first-seen order; up to 32
names are retained per section. Missing observations show “Not observed”. A source should
provide a bounded, stable set of view names. Absence of instance diagnostics disables its
control, and absence of `setInstancesEnabled` makes that control read-only.

Temporal controls route object-history enablement and final/motion/history views to the host.
Eligible, rigid and rejected batches are host observations; rigid/rejected counts can overlap
for mixed batches. Jank does not install a temporal reconstruction algorithm. Freeze copies
both sources and disables their controls; collection/host rendering continue. Each section
collapses independently. These diagnostics are not additional fields in frame recording files;
register meaningful numeric counters separately when they should be retained in recordings.

## Bounded debug bounds

```ts
import { createBoundsOverlay } from "jank.js";
const bounds = createBoundsOverlay(renderer.domElement, { maxBounds: 128 });
// After the host updates camera and visibility, from its existing frame loop:
bounds.render(
  showBounds
    ? {
        bounds: worldAabbs,
        omitted: omittedBounds,
        viewProjection: unjitteredWorldToClip.elements,
        clipDepth: "minus-one-to-one", // WebGL; WebGPU uses "zero-to-one".
      }
    : null,
);
// Host shutdown:
bounds.dispose();
```

Each world AABB supplies finite ordered `min`/`max` triples and `culled`. The matrix is
column-major and must describe the target viewport. The overlay clips all twelve edges in
homogeneous space before perspective division, including near-plane crossings and positive w.
Invalid matrices/boxes and wholly clipped edges are not drawn. Capacity defaults to 128 boxes,
with an explicit maximum of 2048; overflow is available on the canvas's `data-omitted` attribute.
White denotes visible and orange culled. The overlay owns only a pointer-transparent 2D canvas,
follows the target rectangle on render, caps DPR at two, and schedules no animation loop.
Disposal is idempotent. It is a diagnostic overlay, not occlusion, culling or picking logic.

## Demo and evidence

The basic demo's Inspect culling button moves the camera closer. Cube AABB decisions directly
control cube submission; the grid is excluded from those counts. Debug bounds show those same
boxes. This scene has no instanced meshes, so instance diagnostics honestly remain unavailable.
The optional temporal preview tracks a projected corner per rigid cube: motion is amplified ×12,
and history mode marks whether a prior transform observation exists. It is labelled CPU-projected
and is not a GPU velocity buffer, pixel history validity test or temporal antialiasing shader.
The standalone gallery and side-by-side review instead use clearly labelled synthetic sources,
including delayed instance counts. Production engines must supply their actual diagnostics.

Tests cover counter mapping/unavailable values, clipping conventions and near-plane crossings,
canvas capacity/resize/disposal, controls, source errors, missing observations, frozen ownership,
keyboard access and axe checks. The demo tests exercise real culling and both temporal previews.
The [local acceptance report](verification/local-acceptance.md) records suite results and benchmark limits.
