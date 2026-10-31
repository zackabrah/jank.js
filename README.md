# jank.js

A local performance profiler for browser applications. Measure frame pacing and CPU scopes,
inspect optional GPU timings, capture slowdowns with before/after context, and compare recordings
offline. Your application owns the frame loop; Jank adds no render loop or telemetry service.

**Public source preview · `0.2.1-rewrite.6`.** This branch is the rewrite, not the previous API on
`main` or an npm release. APIs and recording formats may change. Both workspace packages retain
`private: true` to prevent accidental registry publication. See [preview compatibility and
limits](docs/public-preview.md) before integrating.

## Try the demo

Use Node **24.22.1** and pnpm **11.24.0**, matching the preview verification environment.

```sh
git clone --branch rewrite/architecture https://github.com/zackabrah/jank.js.git
cd jank.js
pnpm install --frozen-lockfile
pnpm dev:demo
```

Open `http://127.0.0.1:4187/examples/basic/`. The demo includes deliberate CPU hitches, GPU
arithmetic/texture/volume/diffusion workloads, loading diagnostics, recording, and a quick
budget-based headroom estimate. Its stress workloads are examples, not a universal hardware
benchmark. Simulated GPU states are labelled. See the [demo walkthrough](examples/basic/README.md).

For an offline UI demonstration or recording viewer:

```sh
pnpm build:ui-library
pnpm build:viewer
pnpm build:gpu-diagnostic
```

Open the resulting `artifacts/jank-ui-library.html`, `artifacts/jank-viewer.html`, or
`artifacts/jank-gpu-diagnostic.html` directly in a browser. Each is a self-contained file. The
library uses simulated data; the viewer imports your recordings; the diagnostic explicitly
probes native WebGPU timestamps. No scene is instrumented merely by opening these pages.

## Install the preview in an application

Build and pack from this checkout:

```sh
pnpm build
pnpm --filter jank.js pack --pack-destination ../../artifacts
```

Then, from your application's directory, install the generated archive:

```sh
pnpm add /path/to/jank.js/artifacts/jank.js-0.2.1-rewrite.6.tgz
```

The package is ESM with TypeScript declarations, bundled CSS and zero runtime dependencies.
Optional Three.js adapters use your application's renderer. `junkui` is an independent UI
package; Jank already bundles the UI code it needs.

## Connect your existing frame loop

After `document.body` exists:

```js
import { createPanel, createProfiler } from "jank.js";
import "jank.js/styles.css";

const profiler = createProfiler({ targetFps: 60 });
const update = profiler.createChannel({ id: "update", label: "Simulation" });
const panel = createPanel({ container: document.body, profiler, mode: "full" });

// Add these calls to the animation callback your application already invokes.
function onFrame(timestampMs) {
  profiler.beginFrame(timestampMs);
  const token = update.begin();
  // Run your existing simulation here.
  update.end(token);
  // Run your existing renderer here.
  panel.refresh(timestampMs);
}

// On teardown: panel.dispose(); profiler.dispose();
```

Use the animation timestamp with the default clock. Each new frame boundary seals the previous
frame; an unfinished final frame is not fabricated. CPU submission time is not GPU execution
time. See the [integration guide](packages/jank/docs/INTEGRATION.md) for renderer adapters,
scope collection without a full panel, loading sources, capture finalization and disposal.

## What is included

- FULL, MINI and LINE panels; collapsible LIVE, LOADING and CAPTURE groups.
- CPU scopes, counters, events, frame budgets, graphs and optional renderer diagnostics.
- Manual recording and automatic spike or sustained-over-budget capture, with bounded episode
  windows, coverage reporting and explicit export. Automatic capture starts disarmed.
- Optional WebGL2 and pinned Three r186 WebGPU timing, named passes and rejected-timestamp evidence.
- Loading stages, overlapping elapsed time, cold baselines and cache observations.
- Repeatable A/B runs and an offline viewer with overlaid graphs, counter lanes and frame inspection.
- An independent [junkui](packages/junkui/README.md) theme/control library and a
  [designer review pack generator](docs/designer-handoff.md).

Unknown measurements stay unknown. GPU support and timing reliability depend on the browser,
device and adapter. Recordings are bounded, retained in memory and not saved until exported;
long-session chunk export is not implemented. The [usage guide](packages/jank/docs/USAGE.md)
explains these states and the controls.

## Development and verification

```sh
pnpm exec playwright install chromium firefox webkit
pnpm check:full
pnpm bench
pnpm bench:panel
```

`check:full` runs lint/types/contracts/tooling/unit tests, coverage, isolated package consumers,
three-engine browser checks and visual comparisons. Visual baselines require macOS 26 arm64;
other platforms can run the preceding checks individually. Hardware GPU assertions are
capability-dependent and some diagnostic cases require explicit opt-in. Skips are reported,
not counted as successful GPU verification. Do not run competing browser suites on port 4186.

CI checks pushes, pull requests and manual dispatches. It neither bumps versions nor publishes.
`pnpm build:bundle` creates an immutable, versioned local bundle from clean committed source,
including packages, offline pages, guides, synthetic sample data, source identity and checksums.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, issue reports and change verification.
Architecture and ownership are described in [docs/architecture.md](docs/architecture.md);
remaining work is tracked in [docs/rewrite-plan.md](docs/rewrite-plan.md). Historical verification
notes describe the specific build and hardware tested, not a guarantee for every current device.

## License

[MIT](LICENSE). Repository-specific scene assets and private application recordings are not
required to build or use the profiler.
