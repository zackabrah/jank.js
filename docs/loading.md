# Loading measurements

`createLoadingProfiler` owns independent, bounded loading runs. It does not schedule work,
install a frame loop, fetch resources or change renderer caches. Pass it as the panel's
`loading` source; disposing the panel does not dispose it.

```ts
import { createLoadingProfiler, createPanel } from "jank.js";

const loading = createLoadingProfiler();
const panel = createPanel({ container, profiler, loading, mode: "full" });
const run = loading.beginRun({ label: "Scene", kind: "fresh-context" });
try {
  const model = await run.measure("decode", () => decodeModel());
  run.measure("scene preparation", () => installModel(model));
  run.finish("ready");
} catch (error) {
  run.finish("failed");
  throw error;
}
// Host shutdown: panel.dispose(); loading.dispose(); profiler.dispose();
```

`measure` preserves synchronous results/errors and observes promise settlement. Rejected
operations count as failed; an error with `name: "AbortError"` counts as cancelled. The host
still decides the overall run outcome and handles its errors. There is no implicit run finish
when an operation completes. For received bytes or cache observations, use an operation handle:

```ts
const operation = run.startStage("fetch");
operation.recordCache("miss"); // Or "hit" / "in-flight" from the host's actual cache.
operation.addReceivedBytes(chunk.byteLength);
operation.finish(); // Or "failed" / "cancelled".
```

## Ownership and cutoff

Operations stay bound to their original run. Replacing a run seals it as cancelled. Explicit
finish seals all measurements at that instant; pending operations remain counted at cutoff,
not silently treated as complete. Late finish/cache/byte calls and new stages through stale
handles are inert. `measure` through a stale handle still executes the host callback normally.
All finish operations are idempotent. `clear()` invalidates handles and clears snapshots,
history and baseline without recycling IDs; `dispose()` also prevents new runs.

Snapshot/history/baseline results are detached, including nested stage cache counts. The
custom clock must return finite, monotonically nondecreasing milliseconds. Labels are limited
to 240 characters; bytes are nonnegative safe integers. Invalid input throws before changing
that observation. A clock that throws or regresses is an integration error, not a valid sample.

## Bounds and honest timing

Defaults are eight completed runs (oldest first), 128 distinct stages and 4096 operations per
run. `historyCapacity`, `maxStages` and `maxOperations` accept positive integer overrides.
Exceeding a stage/operation limit throws explicitly; no observations are silently dropped.
Stage order is first registration order. Streaming counters accumulate overlap without
retaining every completed interval. History excludes an active run; snapshot returns the
latest run whether active or sealed.

The first successful `fresh-context` run with no pending operations is retained as the cold
baseline independently of history eviction, until clear/dispose. Repeat/editor runs never
masquerade as cold baselines. The host must choose run kinds honestly; a fresh-context label
does not prove the OS/browser/driver cache was cold. Compare like workloads.

- Elapsed run time is the wall-clock interval, including uninstrumented gaps.
- Stage elapsed union counts time with at least one operation active in that stage.
- Stage combined time sums all operations, so overlap can exceed wall time.
- Neither is CPU execution or GPU busy time. Stages can overlap one another too.
- Cache hit rate is hits / (hits + misses); shared in-flight observations stay separate.
- Bytes are reported by the host, including bytes served from browser caches. They do not
  establish network transfer size or cache savings.

The Loading tab shows total/cold/cache tiles, current and dim cold stage bars on one scale,
combined durations, failures/cancellations, cache/bytes and recent sessions. Each main section
collapses independently. Freeze captures loading data without stopping host work. The frame
profiler's CLEAR clears frame data and resumes display; loading has its own explicit clear.
Loading snapshots are not embedded in frame recording exports or the offline viewer schema.

## Evidence

Deterministic tests cover live/closed overlap, gaps, cutoffs, stale async completion, rejected
and cancelled operations, detached nested data, retention, baseline eviction, clear/dispose,
clock validation and capacity errors. Public package consumers instantiate the shipped API.
Browser checks exercise real promises, cold/current bars, cache labels, history, freeze,
borrowed ownership and the basic demo across Chromium, Firefox and WebKit. Narrow/desktop
Loading screenshots and axe checks cover the new UI. The standard collector benchmark was
rerun as a regression check; it does not measure loading operation overhead or prove a speedup.
