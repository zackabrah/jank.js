# Designer review handoff

Generate an offline review pack from the current source with:

```sh
node scripts/designer-handoff.mjs
```

Use the repository's pinned Node and pnpm environment. Install the existing Playwright Chromium
browser if it is not already available. The command builds the standalone library and viewer,
then captures their real components with synthetic fixtures. It creates a new
`artifacts/designer-handoff-<revision>/` directory; an existing directory is never overwritten.
An optional first argument selects another output directory.

Open `index.html` for a filterable screenshot catalogue. The folder also contains a review brief,
full-resolution PNGs, a machine-readable screen inventory, SHA-256 checksums, the standalone
interactive UI library and viewer, and three importable mock files. Zip the complete folder for
sharing; no server or external assets are required.

Coverage includes the library foundation and control tabs, all profiler tab groups, full/mini/line
modes, collapsed groups, GPU availability/rejection states, loading states, automatic/manual capture,
comparison results, viewer disclosures, A/B overlays, import failure and narrow layouts. Focused
panel captures collapse sibling groups to expose each group; lower-content captures retain native
scroll constraints. Screenshots show the existing UI, not design proposals.

The fixtures identify themselves as SIMULATED. They include a spike, a sustained slowdown,
sparse counters, missing/rejected GPU measurements and four ABBA trials. Preview clocks and
synchronous overhead are deterministic synthetic values. Screenshots use reduced motion,
Chromium at 2× resolution, a 1440×1000 desktop viewport and a 390×844 narrow viewport. Use the
interactive library with normal motion settings to inspect animations. Host-specific scene
controls, private assets, native file dialogs and real performance claims are outside this pack.

The capture command asserts that the walkthrough has no page errors or external requests.
Fixture validation tests check that all three files import through the real recording codecs;
the browser preview test checks deterministic stepping and loading states. Before sharing,
visually inspect representative desktop, narrow, failure and comparison images. Keep the pack's
source revision and mock-data label with any extracted images. Generation does not upload or send
anything.
