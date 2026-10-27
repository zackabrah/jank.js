# jank.js

An embeddable performance monitor for browser games and interactive graphics. Inspect frame pacing, measure named CPU systems, record a session, and export the evidence.

**Zero runtime dependencies.** The host owns its frame loop. Optional renderer adapters do not import a renderer. Measurements stay in the browser.

## Install

```sh
npm install jank.js
```

jank.js is an ES module package with TypeScript declarations. To try a build from this repository instead, run `pnpm pack --pack-destination artifacts` and install the archive with `pnpm add /path/to/jank.js-0.1.0.tgz`.

## Integrate

Use a positioned container, import the stylesheet, and call `refresh` from your existing frame loop. This plain JavaScript example also type-checks in TypeScript:

```js
import { createDiagnostics, createPerformanceTray } from "jank.js";
import "jank.js/style.css";
// Optional: import "jank.js/font.css";

const shell = document.querySelector("#app"); // CSS: position: relative
const monitor = createDiagnostics();
const tray = createPerformanceTray({ shell, monitor });
const drawing = monitor.register("drawing", "Canvas drawing");
let animation;

function frame(at) {
  monitor.beginFrame(at);
  const updateStart = performance.now();
  updateScene(); // Your application code.
  const updateMs = performance.now() - updateStart;
  const renderStart = performance.now();
  const measured = drawing.begin();
  drawScene(); // Your application code.
  drawing.end(measured);
  monitor.endFrame(updateMs, performance.now() - renderStart);
  tray.refresh(at);
  animation = requestAnimationFrame(frame);
}
animation = requestAnimationFrame(frame);

addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(animation);
    tray.dispose();
    drawing.dispose();
    monitor.dispose();
  },
  { once: true },
);
```

The next frame boundary seals the preceding interval. Enable recording, expansion, spike capture or DevTools tracks to collect named scopes. Use `monitor.armCapture()` to retain a window around slow frames; configure the frame budget with `monitor.setTargetFps(120)`.

Read the [user manual](docs/user-manual.md) for the panel and viewer. See the [data model and custom views](docs/data-model.md), [integration and adapter contracts](docs/integration.md), [measurement definitions and limits](docs/measurements.md), and [measured overhead](docs/performance.md).

## Recording viewer

The package exports `jank.js/viewer.html`, a self-contained offline viewer. Copy it to your static host and pass its URL as the panel’s `viewerUrl` option; no viewer server API is required. From a checkout of this repository, run `pnpm install --frozen-lockfile` and `pnpm build`, then open **OPEN RECORDING VIEWER.html** to inspect recordings offline, or run `pnpm dev` to open the viewer.

## Development

Development uses **pnpm 11.24.0, Node 22.12+, strict TypeScript, Vite, Vitest, Playwright, oxlint and oxfmt**. React, state libraries, physics, and engine packages are not required. Renderer adapters use structural types. Three.js is used only by projection tests; it and browser-testing packages are development-only dependencies.

```sh
pnpm check                              # Format, lint, unit tests, types and builds
pnpm test:package                       # Install tarball in an isolated consumer
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e                           # Test the packaged panel and viewer (run pnpm build first)
pnpm check:full                         # All of the above checks
pnpm bench                              # Local overhead report in artifacts/overhead.json
pnpm docs:images                        # Refresh the user manual's screenshots (Chromium)
```

The browser suite covers the pinned Chromium, Firefox, and WebKit engines on macOS. Older browsers and mobile devices are not yet certified; see [browser support](docs/measurements.md#browser-support). CI runs the checks and package verification on Ubuntu and Windows, and the browser suite on macOS.

## Contribute and release

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [release guide](docs/releasing.md), and report vulnerabilities as described in [SECURITY.md](SECURITY.md). The package API is an initial 0.x API. Changes to public types and the recording format should be documented in [CHANGELOG.md](CHANGELOG.md).

MIT licensed, copyright Isaac Johnson. Extracted from Junklab Engine 0.94.1 (d6f5036), with independent packaging and a generic API. [Third-party notices](THIRD_PARTY_NOTICES.md) cover the derived control styling and optional font.

Made by [Isaac Johnson](https://github.com/zackabrah) at Junklab, Australia.
