# jank.js test preview

Version **0.2.1-rewrite.1** is a local test build of the readability rewrite. It includes the
profiler, live panel, recording capture/export, bundled UI styles and TypeScript declarations.
It has zero runtime dependencies. The package contains no demo scene, Three.js, private assets
or development tooling. It is ESM and targets modern browsers.

## Install

From the application where you want to test it:

```sh
pnpm add /path/to/jank.js-0.2.1-rewrite.1.tgz
```

Use the actual downloaded archive path. npm and other package managers can also install this
local tarball. No registry publication or separate `junkui` installation is required.

## Connect your frame loop

Import the CSS once through your application's bundler, then create one profiler and panel
after the document body exists:

```js
import { createPanel, createProfiler } from "jank.js";
import "jank.js/styles.css";

const profiler = createProfiler({
  application: { name: "My application" },
  targetFps: 60,
});
const update = profiler.createChannel({ id: "update", label: "update" });
const render = profiler.createChannel({ id: "render", label: "render submit" });
const panel = createPanel({ container: document.body, profiler, mode: "full" });

// Integrate these calls into your existing animation callback.
function onFrame(timestampMs) {
  profiler.beginFrame(timestampMs);

  const updateToken = update.begin();
  // Your existing simulation/update work goes here.
  update.end(updateToken);

  const renderToken = render.begin();
  // Your existing renderer call goes here.
  render.end(renderToken);

  panel.refresh(timestampMs);
}

// When your integration is removed:
function disposeProfiling() {
  panel.dispose();
  profiler.dispose();
}
```

Your application owns and invokes the loop; jank installs no animation loop and never disposes
your renderer. Use the browser's `requestAnimationFrame` timestamp with the default clock.
If supplying a custom `now` clock, frame timestamps must use the same clock and millisecond units.
The next `beginFrame` seals the previous frame; the final open frame is excluded from exports.

FULL and MINI request CPU scopes automatically. To keep collecting scopes in LINE mode or
without a panel, hold `const releaseScopes = profiler.requestScopes()` and call `releaseScopes()`
when finished. Channel rows follow registration order. Timings may overlap; do not add nested
channel totals together. `render submit` measures CPU submission, not GPU execution.

Optional counter providers are passed to `createChannel` as `readCounters: () => ({ count: 42 })`.
Return your actual measurements. Values may be numbers, strings, booleans or null. Use
`profiler.addEvent("Marker")` for timestamped events.

## Record and export

The panel provides REC / STOP REC, automatic hitch capture, FREEZE / RESUME, CLEAR, and
EXPORT JSON. Freezing affects the display while collection continues. Removing the panel
preserves captures; disposing the profiler ends that profiler's lifetime.

For programmatic capture, call `profiler.capture.start()`, collect frames, then call
`profiler.capture.stop()`. It returns a recording or null. `serializeRecording(recording)`
produces validated JSON; `parseRecording(json)` returns an explicit success/error result.
Recent history retains 600 frames, manual captures hold up to 6,000 frames, and the archive
retains ten completed captures.

## Preview limits

- The API and recording schema may still change. This preview writes schema version 3 and
  does not import older recording formats.
- The offline viewer and panel-to-viewer handoff are not implemented yet.
- Loading runtime, renderer timing adapters, visibility/temporal controls and debug bounds
  overlay are not implemented yet. Their draft types are not working runtime factories.
- Host-provided loading/GPU sources and a trace sink can be connected. GPU timings remain
  unavailable unless your host supplies actual measurements; no simulated samples ship here.
- “Unattributed” is frame time outside recorded scope intervals, including browser wait and
  idle time. It is not a measurement of unexplained CPU work.
- Overhead readouts measure synchronous collection and refresh; they exclude deferred paint
  and GPU work.

The MIT license included in the archive covers this package and its bundled junkui code.
