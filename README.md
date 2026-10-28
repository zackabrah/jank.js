```text
    ___  ________  ________   ___  __          ___  ________
   |\  \|\   __  \|\   ___  \|\  \|\  \       |\  \|\   ____\
   \ \  \ \  \|\  \ \  \\ \  \ \  \/  /|_     \ \  \ \  \___|_
 __ \ \  \ \   __  \ \  \\ \  \ \   ___  \  __ \ \  \ \_____  \
|\  \\_\  \ \  \ \  \ \  \\ \  \ \  \\ \  \|\  \\_\  \|____|\  \
\ \________\ \__\ \__\ \__\\ \__\ \__\\ \__\ \________\____\_\  \
 \|________|\|__|\|__|\|__| \|__|\|__| \|__|\|________|\_________\
                                                      \|_________|

  ·:·  JANK.JS  ·:·  A JUNKLAB PRODUCTION  ·:·  every frame leaves a trace  ·:·
```

<p>
  <img alt="Measured, not simulated" src="docs/readme/badge-measured.svg" height="22">
  <img alt="Zero dependencies" src="docs/readme/badge-deps.svg" height="22">
  <img alt="~4.3 KB core" src="docs/readme/badge-core.svg" height="22">
  <img alt="~23 KB with the live panel" src="docs/readme/badge-panel.svg" height="22">
  <img alt="MIT" src="docs/readme/badge-mit.svg" height="22">
  <img alt="v0.1.0" src="docs/readme/badge-version.svg" height="22">
  <img alt="A Junklab production" src="docs/readme/badge-junklab.svg" height="22">
</p>

# jank.js

A performance monitor that runs inside your browser game. It shows frame pacing, the time spent in each system you name, and the slow frame with the frames around it, then exports a recording you can open offline.

Zero runtime dependencies. ~4.3 KB core, ~23 KB with the panel, gzipped. Nothing is uploaded, estimated or smoothed.

<p align="center">
  <img alt="The full jank.js panel running on the fixture game, LIVE tab, recording. The frame graph glides left as frames arrive, a 33.3 ms spike enters in orange and becomes the worst frame, and a load chunk 14 event tick follows it. FPS holds at 60 with its range, 59 to 61, beside it; five CPU systems with unattributed time, GPU passes from the fixture source, counters, and the panel's own overhead under everything." src="docs/readme/panel-running.gif" width="400">
</p>

## Install

```sh
npm install jank.js
```

## Use

Call it from your own frame loop:

```js
import { createDiagnostics, createPerformanceTray } from "jank.js";
import "jank.js/style.css";

const monitor = createDiagnostics();
const tray = createPerformanceTray({
  shell: document.querySelector("#app"), // a positioned element
  monitor,
});
const physics = monitor.register("physics", "Physics", () => ({
  bodies: world.bodyCount,
}));

function frame(at) {
  monitor.beginFrame(at);
  const start = performance.now();
  const scope = physics.begin();
  stepPhysics(); // your update
  physics.end(scope);
  const drawn = performance.now();
  drawScene(); // your render
  monitor.endFrame(drawn - start, performance.now() - drawn);
  tray.refresh(at);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

Mark moments with `monitor.event("Scene changed")`. Only what your app supplies is shown; sections without a source stay hidden.

## The panel

<p align="center">
  <img alt="The full LIVE panel with callouts on its left. FPS 59, with 59 and 61 beside it: frames in the last second, beside the slowest and fastest second. Worst 33.4 ms at frame 195, 2 missed: the slowest frame and when it came, ▲ means over budget. The graph with two orange spikes and three event ticks: each frame against the budget line, with events below. CPU, five rows ending in unattributed 12.0 ms: time in the systems you named, the rest is unattributed. GPU shadow, opaque and post passes from the fixture source: gpu time per render pass, from timer queries. Counters from objects to textures: counts your systems report, by source. FREEZE, STOP REC, CLEAR and EXPORT JSON: freeze the display, record, export for the offline viewer. Overhead, 0.03 ms collection and 0.09 ms panel refresh: what jank.js costs, collecting frames and redrawing this panel. The footer: timer precision here, and the jank.js build." src="docs/readme/panel-annotated.png" width="694">
</p>

Three sizes, all collecting: one line for a playtest, a mini HUD, the full panel when something stutters.

<p>
  <img alt="One line: JANK.JS, 59 fps, 16.8 ms, a 33.4 ms worst frame in orange, REC, and a plus to open the panel." src="docs/readme/panel-line.png" width="400" align="top">
  <img alt="The mini corner HUD while recording: 59 fps, 16.8 ms, 16.7 p95, a rolling frame graph with one orange bar, the worst frame 33.4 ms at frame 92, and the heaviest scope, scene at 1.5 ms." src="docs/readme/panel-mini.png" width="280" align="top">
</p>

**LOADING** puts load stages on one axis, this session against the cold start. **CAPTURE** keeps the frames before and after each spike.

<p>
  <img alt="The LOADING tab: total 301.3 ms against a 602.9 ms cold start, 94 percent cache hits, five stages on one axis with the cold run behind them and decode textures the heaviest, 212 hits and 14 misses, and four sessions listed." src="docs/readme/panel-loading.png" width="400" align="top">
  <img alt="The CAPTURE tab in cooldown: budget 60 fps, auto capture on with a 33.3 ms threshold, 120 frames before and after and a 5 second cooldown, what recordings contain, and one capture kept: frame 97 at 50.0 ms near the wave 3 and spawn ×184 events." src="docs/readme/panel-capture.png" width="400" align="top">
</p>

## The viewer

`jank.js/viewer.html` is one self-contained file. Drop a recording on it to step through every frame, its CPU and GPU lanes, and a labelled guess at the culprit. No server, no network.

<img alt="The recording viewer: the environment line, the session strip with two captures marked, the timeline at 4 px per frame with frame 185 selected at 50.0 ms, 3.0 times the budget, LIKELY scene update at plus 40.0 ms against its median, the exact CPU lanes, the GPU and counter lanes, and the two captures listed." src="docs/readme/viewer.png" width="100%">

## Adapters

Optional, and none imports a renderer. `jank.js/adapters/three` reads `renderer.info` counters. `jank.js/adapters/three-webgpu` and `jank.js/adapters/webgl2` time render passes with GPU timer queries, and report `unsupported` where the browser has none, rather than guessing from CPU time.

## Docs

[User manual](docs/user-manual.md) · [Integration](docs/integration.md) · [Data model](docs/data-model.md) · [Measurements and limits](docs/measurements.md) · [Overhead](docs/performance.md) · [Changelog](CHANGELOG.md)

See it catch something in [Junktro](https://junktro.junklab.au/), a deliberately heavy CRT desktop.

## Develop

```sh
pnpm check          # format, lint, unit tests, types and builds
pnpm test:e2e       # the packaged panel and viewer in Chromium, Firefox and WebKit
pnpm bench          # overhead on your machine
pnpm docs:captures  # retake the README images and social card (needs ffmpeg)
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

MIT © 2026 Isaac Johnson, released by Junklab. [Third-party notices](THIRD_PARTY_NOTICES.md).
