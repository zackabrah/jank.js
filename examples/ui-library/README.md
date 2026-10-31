# Standalone UI library

Run `pnpm build:ui-library`, then open `artifacts/jank-ui-library.html` directly in a browser.
The generated file contains all JavaScript and CSS. It needs no server, network, external fonts,
assets or runtime dependencies. Send that one file to share the current UI library.

The page bundles the current junkui tokens, native controls and accessible tabs, plus real Jank
FULL/MINI/LINE panels. It shows colors, type and sizing tokens, button states, labelled fields,
disclosures, scrolling graphs, annotations, warning colors, CPU/GPU meters, FPS indicators,
loading, recording, visibility, instance and temporal views. All three panels share one synthetic stream; recording, clearing,
budgets and GPU enablement therefore affect the same profiler. Freeze is local to each panel.

Use the sample controls to add a spike or event, pause the stream, or show absent passes,
rejected timestamps, pending results and errors. Rows retain their order and unavailable timing
stays unknown. A seeded capture is ready to export. Exports explicitly identify their application
as **SIMULATED DATA**; this page is an interface showcase, not a device benchmark. Loading values
and optional renderer diagnostics remain labelled synthetic source examples; the basic demo exercises the real loading runtime.

The gallery adds layout around the existing components; it does not reimplement or copy their
styles or behavior. Vite bundles the actual sources and the build script inlines its two outputs.
The generated artifact is ignored by Git; source, builder and browser tests are committed.
For development, the source page is also available at `/examples/ui-library/` under Vite.

`pnpm test:browser tests/browser/ui-library.spec.ts` builds the artifact and tests local-file
interaction, blocked-network operation, keyboard navigation, recording export and validation,
GPU state transitions, mobile layout, reduced motion and axe accessibility in all three browser
engines. WebKit's offline emulation blocks local file navigation, so its network requests are
blocked with routing instead. The sample stream starts paused when reduced motion is requested.

The CAPTURE tab includes the shared A/B comparison controls. Resume the sample stream before
running them. A uses the normal synthetic CPU values; B multiplies synthetic update time by 1.25.
The report and export are real Jank comparison artifacts, clearly labelled simulated; they do not
measure this machine. Changing the GPU example or adding a spike cancels the sample experiment.
