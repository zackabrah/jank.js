import { describe, expect, test } from "vitest";
import { comparisonFixture } from "../compare/fixtures.ts";
import type { GpuFrame } from "../gpu/model.ts";
import { recordingFixture } from "../recording/fixtures.ts";
import type {
  DiagnosticFrame,
  DiagnosticSystem,
  PerformanceRecording,
} from "../recording/types.ts";
import { analyzeDocument, analyzeRecording, spreadWithinVariants } from "./analyze.ts";

/** Frames from their intervals: IDs count from 0 and each frame ends where the next begins. */
function framesOf(intervals: readonly number[], cpu: (index: number) => number = () => 2) {
  let at = 0;
  return intervals.map((interval, id): DiagnosticFrame => {
    const start = at;
    at += interval;
    return {
      id,
      at,
      interval,
      update: cpu(id),
      render: 0,
      scopes: [{ system: "work", label: "Work", start, end: start + cpu(id) }],
      coverage: "complete",
      droppedScopes: 0,
      overhead: { collectionMs: 0, refreshMs: 0 },
    };
  });
}

const recordingOf = (
  frames: DiagnosticFrame[],
  extra: Partial<PerformanceRecording> = {},
): PerformanceRecording => ({ ...recordingFixture(1), frames, ...extra });

const sample = (at: number, values: DiagnosticSystem["values"]) => ({
  at,
  systems: [{ id: "render", label: "Render", cpu: 0, peak: 0, values }],
});

const gpuFrame = (frameId: number, spanMs: number): GpuFrame => ({
  frameId,
  source: "webgpu",
  clock: "gpu",
  epoch: 0,
  resolutionMs: null,
  inventory: "complete",
  omitted: 0,
  invocations: [
    {
      id: "0",
      label: "Scene",
      kind: "render",
      state: "timed",
      milliseconds: spanMs,
      startMs: 0,
      endMs: spanMs,
      reason: null,
    },
  ],
});

describe("episodes", () => {
  test("a clean recording has none, and still reports its summary", () => {
    const report = analyzeRecording(recordingOf(framesOf(Array(100).fill(10))));
    expect(report.episodes).toEqual([]);
    expect(report.omitted).toEqual({ episodes: 0, overBudgetMs: 0 });
    expect(report.summary).toMatchObject({
      frames: 100,
      durationMs: 1000,
      fps: 100,
      frameMs: { median: 10, p95: 10, worst: 10 },
      overBudget: { frames: 0, percent: 0 },
    });
  });

  test("vsync jitter around the budget is not slow, and a real spike stays separate", () => {
    const jittery: number[] = Array.from({ length: 80 }, (_, index) => (index % 2 ? 16.2 : 17.4));
    jittery[40] = 85;
    const report = analyzeRecording(
      recordingOf(framesOf(jittery, (index) => (index === 40 ? 80 : 0.2))),
    );
    expect(report.summary.overBudget).toEqual({ limitMs: 17.67, frames: 1, percent: 1.25 });
    expect(report.episodes).toHaveLength(1);
    expect(report.episodes[0]).toMatchObject({ kind: "spike", frames: 1, worstFrame: 40 });
  });

  // What: the report says unknown when no frame declared an inventory, as the viewer does.
  // Why: issue #8. An agent reading "0/3 complete" would take valid timings for a failed source.
  test("a source with no declared inventory reports unknown coverage", () => {
    const frames = framesOf([16, 16, 16]);
    const report = analyzeRecording(
      recordingOf(frames, {
        gpuTiming: {
          version: 1,
          frames: frames.map((frame) => ({ ...gpuFrame(frame.id, 2), inventory: "unknown" })),
        },
      }),
    );
    expect(report.summary.gpu.coverage).toBe("unknown");
  });

  describe("a display slower than the budget", () => {
    const timedAt = (spanMs: number) => (id: number) => gpuFrame(id, spanMs);
    const atDisplayRate = (spanMs: number | null, intervals: number[]) => {
      const frames = framesOf(intervals);
      return analyzeRecording(
        recordingOf(
          frames,
          spanMs === null
            ? {}
            : {
                gpuTiming: {
                  version: 1,
                  frames: frames.map((frame) => timedAt(spanMs)(frame.id)),
                },
              },
        ),
      );
    };
    const smooth: number[] = Array.from({ length: 80 }, (_, index) => (index % 2 ? 17.3 : 18.3));

    test("doesn't call a smooth run slow, and still finds a real hitch", () => {
      const hitch = smooth.with(40, 60);
      const report = atDisplayRate(2, hitch);
      expect(report.summary.displayLimited).toBe(true);
      expect(report.summary.overBudget.frames).toBe(1);
      expect(report.episodes.map((episode) => episode.worstFrame)).toEqual([40]);
    });

    test("recognises a pinned faster display without moving the budget's limit", () => {
      const report = atDisplayRate(
        2,
        Array.from({ length: 80 }, () => 6.9),
      );
      expect(report.summary.displayLimited).toBe(true);
      expect(report.summary.overBudget).toEqual({ limitMs: 17.67, frames: 0, percent: 0 });
    });

    test("doesn't excuse heavy GPU work at the same frame time", () => {
      const report = atDisplayRate(15, smooth);
      expect(report.summary.displayLimited).toBe(false);
      expect(report.summary.overBudget.frames).toBeGreaterThan(30);
    });

    test("doesn't assume the display without GPU timing", () => {
      expect(atDisplayRate(null, smooth).summary.displayLimited).toBe(false);
    });
  });

  test("a missed frame at the display's rate still counts as slow", () => {
    const report = analyzeRecording(recordingOf(framesOf([16.7, 33.4, 16.7])));
    expect(report.episodes[0]).toMatchObject({ kind: "stall", worstFrame: 1 });
  });

  test("faster frames merged into an episode don't change what its slow frames were", () => {
    const frames = framesOf([50, 10, 10, 50], () => 45);
    const fastIdle = frames.map((frame) =>
      frame.interval === 10 ? { ...frame, update: 0, scopes: [] } : frame,
    );
    expect(analyzeRecording(recordingOf(fastIdle)).episodes[0]?.kind).toBe("spike");
  });

  test("an empty recording reports no statistics rather than zeros", () => {
    const report = analyzeRecording(recordingOf([]));
    expect(report.summary).toMatchObject({ frames: 0, fps: null, frameMs: null, cpuMs: null });
  });

  test("a slow frame explained by CPU scopes is a spike, with its scope and nearby event", () => {
    const frames = framesOf([10, 10, 100, 10], (index) => (index === 2 ? 95 : 2));
    const report = analyzeRecording(
      recordingOf(frames, {
        events: [
          { at: 120, label: "Drop", detail: "Capsule" },
          { at: 5000, label: "Far away", detail: "" },
        ],
      }),
    );
    expect(report.episodes).toHaveLength(1);
    expect(report.episodes[0]).toMatchObject({
      rank: 1,
      kind: "spike",
      firstFrame: 2,
      lastFrame: 2,
      worstFrame: 2,
      startMs: 20,
      worstMs: 100,
      cpuMs: 95,
      unaccountedMs: 5,
      scopes: [{ system: "work", label: "Work", ms: 95 }],
      events: [{ label: "Drop", detail: "Capsule", offsetMs: 100 }],
    });
  });

  test("a slow frame outside CPU scopes is a stall, with GPU work from before it", () => {
    const frames = framesOf([10, 10, 10, 1500, 10]);
    const report = analyzeRecording(
      recordingOf(frames, {
        gpuTiming: { version: 1, frames: [gpuFrame(0, 5), gpuFrame(1, 1400), gpuFrame(4, 6)] },
      }),
    );
    expect(report.episodes[0]).toMatchObject({
      kind: "stall",
      firstFrame: 3,
      cpuMs: 2,
      unaccountedMs: 1498,
      gpu: { frame: 1, spanMs: 1400, expected: 1, timed: 1, rejected: 0, omitted: 0 },
    });
  });

  test("evidence is null rather than invented when a recording has no GPU timing", () => {
    const report = analyzeRecording(recordingOf(framesOf([10, 1500, 10])));
    expect(report.episodes[0]?.gpu).toBeNull();
    expect(report.summary.gpu).toMatchObject({ spanMs: null, passSumMs: null, overlapRatio: null });
  });

  test("reports counters that held steady and then changed, with counts before bytes", () => {
    const frames = framesOf([...Array(30).fill(10), 1000, ...Array(20).fill(10)]);
    const held = { shaderStages: 16, drawCalls: 5, drifting: 1, frameId: 1, stagesBytes: 10 };
    const report = analyzeRecording(
      recordingOf(frames, {
        samples: [
          sample(100, { ...held, drifting: 0 }),
          sample(300, held),
          sample(1400, { ...held, shaderStages: 26, drifting: 2, frameId: 9, stagesBytes: 9000 }),
        ],
      }),
    );
    const steps = report.episodes[0]?.counterSteps;
    expect(steps?.map((step) => step.counter)).toEqual(["shaderStages", "stagesBytes"]);
    expect(steps?.[0]).toEqual({ system: "render", counter: "shaderStages", from: 16, to: 26 });
  });

  test("merges slow frames across short gaps and keeps distant ones apart", () => {
    const report = analyzeRecording(recordingOf(framesOf([50, 10, 10, 50, 10, 10, 10, 10, 50])));
    expect(report.episodes.map((e) => [e.firstFrame, e.lastFrame])).toEqual([
      [0, 3],
      [8, 8],
    ]);
    expect(report.episodes[0]?.overBudgetMs).toBeCloseTo((50 - 1000 / 60) * 2, 1);
  });

  test("ranks by time over budget and counts what the limit leaves out", () => {
    const intervals = [30, 10, 10, 10, 10, 90, 10, 10, 10, 10, 50, 10];
    const report = analyzeRecording(recordingOf(framesOf(intervals)), 2);
    expect(report.episodes.map((e) => [e.rank, e.worstMs])).toEqual([
      [1, 90],
      [2, 50],
    ]);
    expect(report.omitted.episodes).toBe(1);
    expect(report.omitted.overBudgetMs).toBeCloseTo(30 - 1000 / 60, 1);
  });
});

describe("evidence", () => {
  test("reports each CPU scope's median and p95, counting frames without it as zero", () => {
    const frames = framesOf(Array(100).fill(10), (index) => (index >= 90 ? 8 : 0));
    const [work] = analyzeRecording(recordingOf(frames)).summary.cpuScopes;
    expect(work).toEqual({ system: "work", label: "Work", median: 0, p95: 8 });
  });

  test("ranks GPU passes by name, adding repeats like a mip chain together", () => {
    const pass = (id: string, label: string, ms: number): GpuFrame["invocations"][number] => ({
      id,
      label,
      kind: "render",
      state: "timed",
      milliseconds: ms,
      startMs: 0,
      endMs: ms,
      reason: null,
    });
    const frames = framesOf([10, 10, 10]);
    const report = analyzeRecording(
      recordingOf(frames, {
        gpuTiming: {
          version: 1,
          frames: frames.map((frame) => ({
            ...gpuFrame(frame.id, 1),
            invocations: [pass("0", "Main", 2), pass("1", "Mipmaps", 3), pass("2", "Mipmaps 2", 3)],
          })),
        },
      }),
    );
    expect(report.summary.gpu.passes).toEqual([
      { label: "Mipmaps", medianMs: 6, p95Ms: 6, share: 0.75 },
      { label: "Main", medianMs: 2, p95Ms: 2, share: 0.25 },
    ]);
  });

  // What: a host's event still appears when jank.js's own entries alone would fill the list.
  // Why: an episode's events are the clue to what happened. On a slow machine, long-frame entries
  // landed first and hid the host's event.
  test("keeps a host's event in an episode ahead of jank.js's own", () => {
    const frames = framesOf([16, 16, 80, 16, 16]);
    const at = frames[1]?.at ?? 0;
    const entry = (label: string, offset: number) => ({ at: at + offset, label, detail: "" });
    const report = analyzeRecording(
      recordingOf(frames, {
        events: [
          entry("Recording started", 0),
          entry("Long frame", 1),
          entry("Long frame", 2),
          entry("Long frame", 3),
          entry("Long frame", 4),
          entry("Long frame", 5),
          entry("Drop", 6),
        ],
      }),
    );
    expect(report.episodes[0]?.events.map((event) => event.label)).toEqual([
      "Drop",
      "Recording started",
      "Long frame",
      "Long frame",
      "Long frame",
    ]);
  });

  test("tells a cost paid once from one paid every time", () => {
    // One frame every 10 ms, with a 60 ms frame at each planned moment.
    const slowAt = new Set([100, 300, 500, 200, 400, 600]);
    const frames = framesOf(Array.from({ length: 700 }, (_, i) => (slowAt.has(i) ? 60 : 10)));
    const at = (index: number) => frames[index]?.at ?? 0;
    const event = (label: string, detail: string, index: number) => ({
      at: at(index),
      label,
      detail,
    });
    const report = analyzeRecording(
      recordingOf(frames, {
        events: [
          event("Drop", "Mesh", 100),
          event("Drop", "Mesh", 650),
          event("Spawn", "Mesh", 300),
          event("Spawn", "Mesh", 500),
          event("Land", "Cube", 200),
          event("Quiet", "", 680),
          event("Long frame", "not a host moment", 100),
        ],
      }),
    );
    const pattern = (label: string) =>
      report.eventCosts.find((cost) => cost.label === label)?.pattern;
    expect(pattern("Drop")).toBe("first-only");
    expect(pattern("Spawn")).toBe("recurring");
    expect(pattern("Land")).toBe("once");
    expect(pattern("Quiet")).toBeUndefined();
    expect(pattern("Long frame")).toBeUndefined();
  });

  test("reports the worst CPU pressure during the recording, including its starting state", () => {
    const frames = framesOf(Array(100).fill(10));
    const pressure = (at: number, detail: string) => ({ at, label: "CPU pressure", detail });
    const machineWith = (events: { at: number; label: string; detail: string }[]) =>
      analyzeRecording(recordingOf(frames, { events })).summary.machine;
    expect(machineWith([])).toEqual({ cpuPressure: null, busy: false });
    expect(machineWith([pressure(-5, "fair")])).toEqual({ cpuPressure: "fair", busy: false });
    expect(machineWith([pressure(-5, "nominal"), pressure(50, "serious")])).toEqual({
      cpuPressure: "serious",
      busy: true,
    });
    expect(machineWith([pressure(-9, "critical"), pressure(-5, "fair")])).toEqual({
      cpuPressure: "fair",
      busy: false,
    });
  });
});

describe("noise", () => {
  test("is the widest disagreement between runs of the same build", () => {
    expect(
      spreadWithinVariants([
        { variant: "A", value: 10 },
        { variant: "A", value: 14 },
        { variant: "B", value: 8 },
        { variant: "B", value: 9 },
      ]),
    ).toBe(4);
  });

  test("is unknown with only one run of each build, or no values", () => {
    expect(
      spreadWithinVariants([
        { variant: "A", value: 10 },
        { variant: "B", value: 8 },
      ]),
    ).toBeNull();
    expect(
      spreadWithinVariants([
        { variant: "A", value: null },
        { variant: "A", value: undefined },
      ]),
    ).toBeNull();
  });

  test("marks comparison results no larger than it", () => {
    const report = analyzeDocument(comparisonFixture());
    if (report.kind !== "comparison") throw new Error("Expected a comparison report.");
    for (const result of report.results)
      if (result.noise !== null && result.delta !== null)
        expect(result.withinNoise).toBe(Math.abs(result.delta) <= result.noise);
  });
});

describe("trends", () => {
  const series = (read: (index: number) => number, count = 12, stepMs = 1000) =>
    Array.from({ length: count }, (_, index) =>
      sample((index + 1) * stepMs, { buffers: read(index) }),
    );
  const trendsOf = (samples: PerformanceRecording["samples"]) =>
    analyzeRecording(recordingOf(framesOf([10]), { samples })).trends;

  test("flags a counter still rising at the end, with its rates", () => {
    expect(trendsOf(series((index) => 100 + index * 10))).toEqual([
      {
        rank: 1,
        system: "render",
        counter: "buffers",
        first: 100,
        last: 210,
        perSecond: 10,
        finalThirdPerSecond: 10,
        windowSeconds: 11,
        monotonicShare: 1,
      },
    ]);
  });

  test("ignores warm-up that has levelled off, oscillation, and constants", () => {
    expect(trendsOf(series((index) => Math.min(index, 5) * 100))).toEqual([]);
    expect(trendsOf(series((index) => (index % 2 ? 100 : 200)))).toEqual([]);
    expect(trendsOf(series(() => 100))).toEqual([]);
  });

  test("ignores frame IDs and tiny growth", () => {
    const ids = Array.from({ length: 12 }, (_, index) =>
      sample((index + 1) * 1000, { frameId: index * 100 }),
    );
    expect(trendsOf(ids)).toEqual([]);
    expect(trendsOf(series((index) => 1000 + index))).toEqual([]);
  });

  test("needs enough samples over enough time to call anything a trend", () => {
    expect(trendsOf(series((index) => index * 10, 5))).toEqual([]);
    expect(trendsOf(series((index) => index * 10, 12, 100))).toEqual([]);
  });
});

describe("documents", () => {
  test("a recording dispatches to the recording report and honours the limit", () => {
    const recording = recordingOf(framesOf([50, 10, 10, 10, 10, 50, 10, 10, 10, 10, 50]));
    expect(analyzeDocument(recording, 1)).toMatchObject({
      kind: "recording",
      omitted: { episodes: 2 },
    });
  });

  test("a comparison reports verdicts, confounds and each trial's worst frame", () => {
    const bundle = comparisonFixture();
    const report = analyzeDocument(bundle);
    expect(report).toMatchObject({
      kind: "comparison",
      status: bundle.status,
      change: bundle.change,
    });
    if (report.kind !== "comparison") throw new Error("Expected a comparison report.");
    expect(report.results.map((result) => result.id)).toContain("Frame-median");
    expect(report.trials).toHaveLength(bundle.trials.length);
    expect(report.trials[0]?.worstMs).toBeGreaterThan(0);
  });
});
