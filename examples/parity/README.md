# Original / rewrite review

Run the rewrite dev server on port 4187 (`pnpm dev:demo`), then:

```sh
node --experimental-strip-types scripts/parity-preview.mjs /path/to/original/jank.js
```

Open <http://127.0.0.1:4189/examples/parity/>. The local server exposes only four allowlisted
files from the original `dist-package`, and proxies the rewrite dev server. It never writes
to the original checkout. The original package must already be built; do not rebuild the
reference as part of a comparison. The script prints its embedded build identity.

The viewer panes receive the same synthetic frame boundaries, CPU scopes, events and scripted
GPU observations, encoded separately for the two incompatible file versions. This conversion
is only a review fixture, not production support for old files. Both panels exercise their
native collection APIs with the same synthetic frames and scopes. Their scope averaging and
visible graph windows may differ; this page is not an overhead or GPU benchmark.

Use View to switch between the offline viewers and FULL/MINI/LINE panels, or Loading. Use `?view=loading` to open Loading directly. Fit displays native
viewports at equal scale; Actual size enables scrolling without shrinking typography. Narrow
uses a 390-pixel native viewport. The controls within each pane remain interactive. Reset
reloads both panes and aligns the viewers to spike #243 with a similar visible range. Loading runs use matched scripted fetch/decode intervals through each native API (600ms cold,
100ms repeat), including overlapping cold fetch operations and explicit synthetic cache counts.
Visibility / temporal compares matched synthetic host observations and controls. These demonstrate
the integration UI, not production renderer culling or temporal reconstruction.

Reference used for the October 31 audit: built 0.2.1, commit `eeed4c7`, marked local changes by
its build metadata. Preserve that distinction when comparing against later source changes.
