# Agent interface

Prototype. Lets an agent or script record a host and read a short report, instead of
clicking the panel and parsing a recording that can run to tens of megabytes. The report
schema may still change. `window.jank` ships in the package as `jank.js/agent`, and
`jank analyze` as the package's `jank` command. `jank experiment` drives a browser with
Playwright, so it only runs from this repository.

## Analyze a file

```sh
npx jank analyze recording.json --top 5
```

This takes a recording or a comparison exported from the panel or viewer, and prints
JSON to stdout. `--top` limits each list (default 10). It exits 1 if the file can't be
read or isn't valid, and 2 for bad arguments. In this repository, `pnpm -s jank analyze` runs the
same command from source, which needs Node 22.18 or later.

## Drive a running host

A host opts in by passing its capture controller:

```ts
import { installAgentApi } from "jank.js/agent";

const remove = installAgentApi(window, panel.capture, { event: monitor.event });
// At host teardown:
remove();
```

`/checks/three.html` does this. From a page script or a browser automation tool:

```js
window.jank.start();
// ...exercise the scene...
const { id, report } = await window.jank.stop(5); // Optional list limit.
window.jank.report(id); // Saved captures, latest by default.
window.jank.export(id); // Recording JSON, for the viewer or `jank analyze`.
window.jank.status(); // Phase, frame count, saved captures, and any error or block.
```

This is the same capture a person drives with Rec, so the two share one recorder.
`start` throws if a comparison or another recording holds it. `stop` waits for GPU
results and rejects if they fail, so an agent can't mistake a failure for a clean report.

## Compare two builds

From this repository:

```sh
pnpm -s jank experiment --a <url> --b <url> --out results --label-a before --label-b after
```

This loads fresh pages in A-B-B-A order, records each through `window.jank`, saves the trials
and a comparison the viewer can open, and prints the results as JSON. `--cdp <url>` drives a
browser already running, such as on another machine over an SSH tunnel.

- **To try a change without a second build:** use the same URL for both, with
  `--replace-b 'glob::find::to'` patching B's responses. A patch that matches no request, or
  no text in one, fails the run, so a stale patch can't quietly test nothing.
- **To force a first-visit compile:** use `--replace` with `{nonce}` in a shader constant.
- **To check the image:** `--scenario <file>` reaches a repeatable state before recording, and
  `--screenshot` compares the builds' last frames. The noise floor is the difference between
  two runs of A, so a result near it means no visible change. It needs a repeatable scene.
- **For CPU hotspots:** `--profile` adds separate loads, so the profiler can't affect the
  timings. Its numbers are for ranking, because sampling inflates short functions.
- **For the noise floor:** compare a build with itself.

Each comparison result has `noise`, the widest gap between runs of one build, and
`withinNoise`, which means two runs of the same build differed by at least as much as the
builds did. Read a `withinNoise` result as no evidence either way, whatever its verdict.
`displayLimited` means the display set the frame time in every trial. Frame median and p95 then
read `Display-paced` instead of a faster or slower verdict, unless a trial's p95 is past its
slow-frame limit, so use the CPU and GPU results. `machineBusy` means the browser reported CPU
pressure. That reading is coarse, so `noise` is the better guard.

## Host evidence

The more a host reports, the more a report can say:

- **Startup:** `performance.measure` around each phase shows up under `loads[].load.measures`.
- **Moments:** `monitor.event` for meaningful moments gives `eventCosts`, which separates a
  cost paid only the first time from one paid every time. Those need different fixes.
- **GPU passes:** `describePass`, the third argument to `instrumentThreeDevice`, names them.
- **GPU calls:** `gpuCalls()` on the same probe adds pipelines, textures, buffers and bind
  groups created so far, plus buffer writes and submits per frame, as counters. A step in a
  created count beside a slow frame shows resources being set up during it.
- **Long frames:** passing `{ event: monitor.event }` to `installAgentApi` adds long frames, with
  their scripts, and CPU pressure as events to recordings it starts. A person's own recordings
  and event list don't change. "scripts: none" points outside the page's
  JavaScript, such as a wait on the GPU.

## Recording report

| Field      | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| `summary`  | Frame, CPU and GPU statistics, over-budget share and jank's cost |
| `episodes` | Runs of over-budget frames, ranked by total time over budget     |
| `omitted`  | How many episodes the limit left out, and their time over budget |
| `trends`   | Counters rising steadily and still rising at the end             |
| `notes`    | How to read the above                                            |

A frame counts as slow above `summary.overBudget.limitMs`, the budget plus 5% or 1 ms,
whichever is larger. This is the panel's and viewer's rule too. Without it, vsync jitter makes
a smooth run look over budget when the display's frame time equals the budget.

`summary.fps` uses measured frame intervals; `summary.durationMs` retains wall-clock gaps. A host can use `monitor.resetFrame()` around known pauses so they do not become stall findings. Unmarked pauses remain indistinguishable from real stalls.

`summary.displayLimited` means the busier of median CPU and GPU work uses under 80% of both the
typical frame time and the budget, so the display is setting the pace, as on a 57 Hz or a 144 Hz
screen. A frame then counts as slow against the larger of the typical frame time and the budget.
The panel, viewer and comparison use the same rule. This needs GPU timing, because a GPU-limited
scene looks the same without it. Sustained and episode capture rules use it too; a spike rule keeps
its own threshold.

Each episode has frame IDs, so its details can be found in the viewer, and this evidence:

- **`kind`:** `spike` means CPU scopes account for at least half the time of its slow
  frames. `stall` means most of that time is outside instrumented CPU work, such as GPU
  waits or other load.
- **`scopes`:** the longest CPU scopes, with matching system/label intervals unioned within each frame before summing. Summary CPU-scope statistics use the same union; different labels may overlap.
- **`events`:** host events within 50 ms. Hosts get more from this by reporting their
  meaningful moments with `monitor.event`.
- **`gpu`:** the longest GPU span from 5 frames before the episode to its end. GPU work
  can stall a later frame, so it may not be the same frame.
- **`counterSteps`:** counters that held steady and then changed across it.

A comparison report has the panel's verdicts, any settings that also differ, and each
trial's worst frame.

## Limits

- Findings are observations, not causes. A step in `shaderStages` next to a stall is a
  lead to test, not proof of a shader compile.
- A recording holds at most 6,000 frames, about 42 s at 144 Hz, so a trend may be warm-up.
  Compare the same counter later in the session before calling it a leak.
- `gpu.overlapRatio` above 1 means passes overlap, so pass times are not costs.
