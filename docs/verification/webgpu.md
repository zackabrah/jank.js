# Complete WebGPU profiling verification

Local verification: 2026-10-30, Apple M3 Max, arm64 macOS 26.5.2, Node 26.12.1,
pnpm 11.24.0, Playwright 1.63.0, Three.js 0.186.1. Preview: `0.2.1-rewrite.3`.
The [integration guide](../gpu-adapters.md) defines ownership, brackets, labels and limits;
[recording documentation](../recordings.md) defines schema 4 and bounded finalization.

## Correctness evidence

`pnpm check:full` passed: formatting/lint, strict types, browser-free contracts, tooling policy,
189 unit/property cases, per-file 90% coverage floors, isolated built-package consumers,
125 browser cases and 12 visual cases across Chromium, Firefox and WebKit. Seven browser cases
are explicitly skipped: three opt-in benchmarks and four raw-readback/finalization checks on
Chromium/Firefox, where native timestamp queries were unavailable. GPU panel screenshots were
visually inspected at 360px viewport width in all engines.

Controlled tests cover disjoint/overlapping/nested intervals, exact large timestamp origins,
compute-only/render-only/mixed/empty frames, repeated native passes and IDs, out-of-order
completion, read failures/timeouts, query/queue pressure, bounded retention, resource reuse,
device loss, toggles, repeated attachment, descriptor restoration, cancellation and observer
disposal. CPU and WebGL2 tests remain passing. Finalization tests cover late merges, timeouts,
detached results, capacity, malformed results, preservation of legacy samples and round trips.

Regressions were observed before fixes: native layered passes reused one Three descriptor;
older results replaced newer displays after errors; synchronous submission failures and async
label callbacks leaked rejected promises. Finalization tests first failed on the missing API;
further tests caught unintended legacy sample deduplication.

## Independent raw timestamps on actual WebGPU

The WebKit fixture ran two TSL compute dispatches and two scene render calls inside one bracket.
This produced **two compute and four native render passes**, including renderer utility passes.
A test-only observer installed before Jank saw every final native query pair, resolved them
independently into separate buffers before reuse, and recomputed metrics with a separate BigInt
endpoint sweep. Every timestamp and all five aggregates matched exactly: **0ns discrepancy**.

[Raw comparison evidence](webgpu-readback.json), application frame 5:

| Metric            | Jank and independent calculation, ms |
| ----------------- | -----------------------------------: |
| Render pass sum   |                             0.117208 |
| Compute pass sum  |                             0.021500 |
| Combined pass sum |                             0.138708 |
| GPU busy union    |                             0.116083 |
| GPU elapsed span  |                             0.279500 |

The comparison uses **the same hardware query values through a separate readback**, not a second
clock. It verifies association, preservation, precision and aggregation, not external GPU clock
calibration. Timestamp quantization remains browser/device dependent. CPU/GPU totals are never
added. A separate browser case stopped capture with a pending hardware readback and verified that
bounded finalization included its original application frame with complete interval coverage.

WebGL2 hardware timer support was unavailable in all three local headless engines. Those paths
verify truthful unsupported states and host rendering after disposal. WebGL2 timing, disjoint
and device-loss cases are controlled tests, not hardware fault injection.

## Instrumentation overhead and resources

Run separately with no concurrent build/source edits while Vite serves the measurement:

```sh
JANK_GPU_BENCHMARK=1 pnpm exec playwright test tests/browser/gpu.spec.ts \
  --project=webkit --workers=1 --grep 'overhead and resource'
```

The [raw overhead report](webgpu-overhead.json) contains three rotating-order batches per mode,
20 warm-up frames then 120 measured frames each: **360 measured frames per mode**, 1,080 total.
Modes are no adapter, attached but disabled, and enabled. Each frame submits the same two compute
and two render calls. Timers surround synchronous submission, brackets, labels and readback
enqueueing. Async completions run between frames. Panel refresh is excluded. The test-only
resource observer is present in every mode.

| Mode             | Mean synchronous ms/frame | Range of batch means, ms | Median frame, ms |
| ---------------- | ------------------------: | -----------------------: | ---------------: |
| No adapter       |                     1.044 |              0.808–1.400 |                1 |
| Disabled adapter |                     1.031 |              0.908–1.158 |                1 |
| Enabled adapter  |                     1.158 |              1.042–1.333 |                1 |

Observed enabled-minus-baseline mean: approximately **0.114ms/frame**. All individual CPU durations
were integer milliseconds (observed values 0, 1, 2, 3, 5ms), and batch variation overlaps this
difference. This run **does not establish a reliable submillisecond overhead estimate** or prove
that disabled collection is faster. It excludes deferred callback processing, GPU query execution
cost, driver allocations, layout/paint and total application slowdown. This small fixture is not
a production budget or performance guarantee.

Enabled batches held **one query set and two buffers, 8,192 bytes**, unchanged from warmup through
the final measured frame. No further buffers/query sets were created during those batches.
Retained results reached their 128-frame cap; one readback was pending at each final synchronous
boundary. Disabled batches allocated none. After final disposal the observer counted **zero live
Jank buffers and query sets**. This demonstrates explicit resource stability in this run, not a
JS heap/driver leak audit. Controlled tests separately saturate queue bounds and cancel maps.

`pnpm bench` passed. [Collection results](webgpu-collection.json) include collection/capture
workloads and measurement limits. They exclude adapters, GPU/driver work and browser UI and
must not be presented as WebGPU instrumentation overhead.

## Compatibility and remaining limits

- Schema 4 rejects schemas 1–3; legacy duration variants stay distinct from intervals.
- Bracket first compute through final render. The old end-only `captureFrame` integration must
  change. Work outside brackets and command buffers submitted after closing are unsupported.
  Initialize compute/render resources before the loop; label callbacks must be synchronous.
- Private Three hooks are guarded to revision 186 and verified on 0.186.1. Other revisions need
  verification. Device encoders must permit instance method replacement. Ownership is exclusive
  across renderer/device; foreign timestamp writes make the bracket incomplete.
- Finalization is programmatic; panel STOP/EXPORT remain synchronous. Export the returned
  recording. The original archive stays unchanged. Timeouts are subject to event-loop scheduling.
- Real timestamp evidence is from WebKit on this machine. Chromium/Firefox exercised unsupported
  paths. No real device-loss injection, production scene benchmark or cross-device guarantee.
- Offline viewer/loading runtime and complete original-tool parity remain pending. `check:full`
  runs implemented gates; passing it does not claim those features exist.

The original checkout and Red Skies reference remained read-only. No production targets changed;
no package, branch or site was published.

## Local archive

`jank.js-0.2.1-rewrite.3.tgz`: **110,189 bytes**, 65 package entries.
SHA-256: `ef37c1abc0e7e14f9a07e7fe9a1c6fcda230826b0b83427d15444ef672354555`.

The actual archive passed an offline installation into a temporary consumer, root/adapter and
finalization TypeScript checks, browser-free imports without Three/junkui, zero runtime dependency
checks, and panel/styles/scopes/counters/capture-export/disposal checks in Chromium 153.0.8010.12,
Firefox 155.0 and WebKit 26.6. No external network requests or page errors occurred. Its contents
are tool distribution files, package metadata, README and license; no demonstration scene,
private reference content or renderer dependency is included.
