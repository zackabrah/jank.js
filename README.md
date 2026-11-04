```text
    ___  ________  ________   ___  __          ___  ________
   |\  \|\   __  \|\   ___  \|\  \|\  \       |\  \|\   ____\
   \ \  \ \  \|\  \ \  \\ \  \ \  \/  /|_     \ \  \ \  \___|_
 __ \ \  \ \   __  \ \  \\ \  \ \   ___  \  __ \ \  \ \_____  \
|\  \\_\  \ \  \ \  \ \  \\ \  \ \  \\ \  \|\  \\_\  \|____|\  \
\ \________\ \__\ \__\ \__\\ \__\ \__\\ \__\ \________\____\_\  \
 \|________|\|__|\|__|\|__| \|__|\|__| \|__|\|________|\_________\
                                                      \|_________|
```

<p>
  <img alt="Nothing else to install" src="docs/readme/badge-deps.svg" height="22">
  <img alt="~4.6 KB core" src="docs/readme/badge-core.svg" height="22">
  <img alt="~64 KB with the live panel" src="docs/readme/badge-panel.svg" height="22">
  <img alt="MIT" src="docs/readme/badge-mit.svg" height="22">
  <img alt="Current version" src="docs/readme/badge-version.svg" height="22">
  <img alt="A Junklab production" src="docs/readme/badge-junklab.svg" height="22">
</p>

<p>
  <img alt="Unit tests passing" src="docs/readme/badge-unit.svg" height="22">
  <img alt="Chromium tests passing" src="docs/readme/badge-chromium.svg" height="22">
  <img alt="Firefox tests passing" src="docs/readme/badge-firefox.svg" height="22">
  <img alt="WebKit tests passing" src="docs/readme/badge-webkit.svg" height="22">
  <img alt="Unit test line coverage" src="docs/readme/badge-coverage.svg" height="22">
</p>

# jank.js

A performance monitor that runs inside your browser game. It shows frame pacing, the time spent in each system you name, and the slow frame with the frames around it. Record what happened, compare two versions of your workload, and read the results in a viewer that never leaves your machine.

Nothing to install beyond the package: its small UI runtime is bundled. ~4.6 KB core, ~64 KB with the panel, gzipped; the viewer loads only when you open it. Nothing is uploaded, estimated or smoothed. Missing data stays missing.

<p align="center">
  <img alt="The full panel on its LIVE tab, measuring a real Three.js scene on WebGPU. The frame graph scrolls as frames arrive, an 80 ms spike enters in orange and becomes the worst frame, and the CPU and GPU sections below report the time spent." src="docs/readme/panel-running.gif" width="360">
</p>

## Install

```sh
npm install jank.js
```

## Use

Call it from your own frame loop:

```js
import { createDiagnostics } from "jank.js";
import { createPerformancePanel } from "jank.js/panel";

const monitor = createDiagnostics();
const panel = createPerformancePanel({ shell: document.body, monitor });
const physics = monitor.register("physics", "Physics", () => ({
  bodies: world.bodyCount,
}));

function frame(at) {
  monitor.beginFrame(at);
  panel.refresh(at);
  const start = performance.now();
  const scope = physics.begin();
  stepPhysics(); // your update
  physics.end(scope);
  const drawn = performance.now();
  drawScene(); // your render
  monitor.endFrame(drawn - start, performance.now() - drawn);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

Mark moments with `monitor.event("Scene changed")`. Only what your app supplies is shown; sections without a source stay hidden or read as unavailable, never as zero.

## The panel

It floats in a corner of the viewport, in its own Shadow DOM, so your styles and its styles cannot touch. Three sizes, all collecting: one line for a playtest, a mini HUD, the full panel when something stutters. It's built for desktop widths.

<p>
  <img alt="The one-line view: live status, p95 frame time, frames per second and the share over budget." src="docs/readme/panel-line.png" width="360" align="top">
  <img alt="The mini view: p95, frame rate and over-budget figures above a rolling frame graph, with the worst frame and the heaviest system below." src="docs/readme/panel-mini.png" width="240" align="top">
</p>

**CAPTURE** records manually, or automatically on a spike, a sustained slowdown or a whole episode, keeping the frames before and after. **LOADING** puts your load stages on one axis, with cold and repeat runs compared. **COMPARE** runs an A/B test.

<p>
  <img alt="The CAPTURE tab: its automatic capture rule and manual recording controls." src="docs/readme/panel-capture.png" width="360" align="top">
  <img alt="The LOADING tab: a real load and compile, its stages on one time axis, with cold-run and cache figures reading unknown where the host has not supplied them." src="docs/readme/panel-loading.png" width="360" align="top">
</p>

## A/B comparison

Report two variants and how to switch between them, and the panel runs them in alternating pairs with warm-up, then gives a verdict for CPU, GPU and frame time:

```js
const shadows = getShadows();
const panel = createPerformancePanel({
  shell: document.body,
  monitor,
  comparison: {
    change: "shadows",
    variants: {
      A: { label: "Shadows on", settings: { shadows: true } },
      B: { label: "Shadows off", settings: { shadows: false } },
    },
    activate: (variant) => setShadows(variant === "A"),
    restore: () => setShadows(shadows),
  },
});
```

Other settings that differ are flagged as confounds. Results are a quick estimate, not a significance test: read the size of the difference beside each verdict. Stopped and failed runs keep their finished trials.

<img alt="The comparison viewer on a real run of Baseline against CPU stress: verdict cards reading B slower on CPU and frame time, aligned frame-time graphs for A and B, and the paired frames under the cursor compared in the inspector." src="docs/readme/viewer-compare.png" width="800">

## The viewer

Open a saved capture from the panel, or use `jank.js/viewer.html`: one self-contained file. Choose a recording or comparison to step through every frame, its CPU and GPU lanes, its counters and its evidence.

<img alt="The recording viewer on a real capture with three 80 ms spikes: summary tiles, an overview with ranked spike markers, aligned CPU and GPU lanes, and the worst frame open in the inspector." src="docs/readme/viewer.png" width="800">

## Adapters

Optional, and none bundles a renderer. `jank.js/adapters/three` reads `renderer.info` counters. `jank.js/adapters/three-webgpu` and `jank.js/adapters/webgl2` time GPU passes: pass the source they return as `gpu`. `jank.js/adapters/three-host` adds renderer errors, instance and loading observers for Three.js hosts. `jank.js/gpu` gives frame-linked GPU evidence for recordings.

## Upgrading from 0.3

`createDiagnostics` and the rest of the core API, the recording format and existing recordings are unchanged. The panel and viewer are new:

```diff
-import { createDiagnostics, createPerformanceTray } from "jank.js";
-import "jank.js/style.css";
+import { createDiagnostics } from "jank.js";
+import { createPerformancePanel } from "jank.js/panel";

-const tray = createPerformanceTray({ shell, monitor, gpu });
+const panel = createPerformancePanel({ shell, monitor, gpu });
```

Call `panel.refresh(at)` straight after `monitor.beginFrame(at)`, and `panel.destroy()` instead of `tray.dispose()`. See [the changelog](CHANGELOG.md) for what was removed.

## Docs

[Integration](docs/integration.md) · [Data model](docs/data-model.md) · [Measurements and limits](docs/measurements.md) · [Overhead](docs/performance.md) · [GPU measurements](docs/gpu-measurements.md) · [Three.js playground](docs/three-playground.md) · [Architecture](docs/architecture.md)

See it catch something in [Junktro](https://junktro.junklab.au/), a deliberately heavy CRT desktop.

## Develop

```sh
pnpm dev            # the playground and review pages
pnpm check          # lint, types, unit tests and builds
pnpm test:package   # the packed tarball in a clean consumer
pnpm test:e2e       # the panel, viewer and built package in Chromium, Firefox and WebKit
pnpm test:e2e:gpu   # real GPU timing in Chrome on your hardware
pnpm docs:captures  # retake the README images from a real run (needs Chrome and ffmpeg)
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

MIT © 2026 Isaac Johnson, released by Junklab. [Third-party notices](THIRD_PARTY_NOTICES.md).
