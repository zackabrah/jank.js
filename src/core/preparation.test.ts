import { describe, expect, it } from "vitest";

import {
  createPreparationProfiler,
  measurePreparation,
} from "./preparation.ts";

describe("application-defined preparation stages", () => {
  it("retains custom stages, declared ordering and overlapping elapsed work", () => {
    let now = 0;

    const profiler = createPreparationProfiler({
      now: () => now,
      stages: ["audio", "sprites"],
    });

    profiler.start({ label: "Custom app", kind: "fresh-context" });

    const endSprite = profiler.begin("sprites");

    const endAudio = profiler.begin("audio");

    now = 5;

    const endSecondAudio = profiler.begin("audio");

    now = 10;

    endAudio();

    endSprite();

    now = 15;

    endSecondAudio();

    profiler.measure("custom-shaders", () => {
      now = 20;
    });
    profiler.finish("ready");

    expect(profiler.snapshot()?.stages.map((s) => s.stage)).toEqual([
      "audio",
      "sprites",
      "custom-shaders",
    ]);
    expect(profiler.snapshot()?.stages[0]).toMatchObject({
      totalMs: 20,
      busyMs: 15,
      count: 2,
    });
    expect(profiler.snapshot()?.elapsedMs).toBe(20);
  });

  it("seals replaced sessions so late completions cannot contaminate new measurements", async () => {
    let now = 0;

    const profiler = createPreparationProfiler({ now: () => now });

    profiler.start({ label: "Old", kind: "fresh-context" });

    let resolve: (() => void) | undefined;

    const pending = profiler.measure(
      "download",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );

    now = 10;

    profiler.start({ label: "New", kind: "repeat-session" });

    now = 20;

    resolve?.();

    await pending;

    expect(profiler.snapshot()?.stages).toEqual([]);
    expect(profiler.history()[0]).toMatchObject({
      status: "cancelled",
      elapsedMs: 10,
      pending: 1,
    });
    expect(() => profiler.begin(" ")).toThrow("must have a name");
  });
});

describe("recording outside a live run", () => {
  // What: before any run starts, and once a run is sealed, every recorder call is a no-op:
  // begin returns a callback that does nothing, measure just runs the work, and cache and
  // bytes are dropped. That includes a recorder captured before the run was finished.
  // Why: hosts leave their loading instrumentation in place permanently. Work that runs
  // outside a profiled run, or finishes late after the run was sealed, must neither throw
  // nor change a snapshot that the panel has already shown or exported.
  it("ignores every call before a run starts and after it is sealed", () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.finish("ready");

    profiler.begin("fetch")();

    profiler.cache("fetch", "hit");
    profiler.bytes("fetch", 10);

    expect(profiler.measure("fetch", () => 42)).toBe(42);
    expect(profiler.snapshot()).toBeNull();
    expect(profiler.history()).toEqual([]);

    profiler.start({ label: "Run", kind: "fresh-context" });

    const captured = profiler.capture();

    profiler.finish("ready");
    profiler.finish("failed");

    captured.begin("fetch")();

    captured.cache("fetch", "miss");
    captured.bytes("fetch", 5);

    profiler.cache("fetch", "hit");

    expect(profiler.snapshot()).toMatchObject({ status: "ready", stages: [] });
    expect(profiler.history()).toHaveLength(1);
  });
});

describe("how measure classifies work that throws", () => {
  // What: sync throws and async rejections count as errors in their stage, while an
  // AbortError, or any error once the caller's AbortSignal has aborted, counts as
  // cancelled. The original error always reaches the caller unchanged.
  // Why: the LOADING view separates loads that broke from loads the user abandoned, so
  // a cancelled fetch must never be reported as a failure. Rethrowing the same error
  // object keeps the host's own error handling working exactly as it would unprofiled.
  it("counts failures and cancellations separately and rethrows the original error", async () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.start({ label: "Errors", kind: "editor" });

    const broken = new Error("decode failed");

    const abort = new DOMException("stopped", "AbortError");

    const aborted = AbortSignal.abort();

    expect(() =>
      profiler.measure("model-decode", () => {
        throw broken;
      }),
    ).toThrow(broken);

    await expect(
      profiler.measure("model-decode", () => Promise.reject(broken)),
    ).rejects.toBe(broken);

    // Errors that aren't Error objects still count as failures, not cancellations.
    await expect(
      profiler.measure("model-decode", () => Promise.reject("text")),
    ).rejects.toBe("text");

    await expect(
      profiler.measure("model-decode", () => Promise.reject({ code: 1 })),
    ).rejects.toEqual({ code: 1 });

    expect(() =>
      profiler.measure("fetch", () => {
        throw abort;
      }),
    ).toThrow(abort);

    await expect(
      profiler.measure("fetch", () => Promise.reject(abort)),
    ).rejects.toBe(abort);

    await expect(
      profiler.measure("fetch", () => Promise.reject(broken), aborted),
    ).rejects.toBe(broken);

    expect(() =>
      profiler.measure(
        "fetch",
        () => {
          throw broken;
        },
        aborted,
      ),
    ).toThrow(broken);

    const stages = profiler.snapshot()!.stages;

    expect(
      stages.find((stage) => stage.stage === "model-decode"),
    ).toMatchObject({ count: 4, errors: 4, cancelled: 0 });
    expect(stages.find((stage) => stage.stage === "fetch")).toMatchObject({
      count: 4,
      errors: 0,
      cancelled: 4,
    });
  });

  // What: the callback from begin() takes an optional status, and only its first call
  // counts.
  // Why: hosts that can't wrap work in measure() report outcomes themselves, often from
  // several event handlers (load, error, abort) that may all fire. Ending a span twice
  // must not double-count its time or its outcome.
  it("records the status passed to a begin() callback once", () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.start({ label: "Manual", kind: "fresh-context" });

    const end = profiler.begin("pipeline-compile");

    end("failed");

    end("failed");

    profiler.begin("pipeline-compile")("cancelled");

    profiler.begin("pipeline-compile")();

    expect(profiler.snapshot()!.stages[0]).toMatchObject({
      count: 3,
      errors: 1,
      cancelled: 1,
    });
  });
});

describe("timing", () => {
  // What: a clock that returns NaN or steps backwards is clamped to its last good time.
  // Why: the host supplies the clock and it may be a game-time or test clock. A bad
  // reading must not produce negative or NaN durations that would corrupt totals,
  // graphs and exported recordings.
  it("clamps a clock that goes backwards or returns NaN", () => {
    const readings = [10, Number.NaN, 5, 20];

    let read = 0;

    const profiler = createPreparationProfiler({
      now: () => readings[read++] ?? 20,
    });

    profiler.start({ label: "Clock", kind: "fresh-context" });

    profiler.begin("warmup")();

    profiler.finish("ready");

    expect(profiler.snapshot()).toMatchObject({ elapsedMs: 10 });
    expect(profiler.snapshot()!.stages[0]).toMatchObject({
      totalMs: 0,
      busyMs: 0,
    });
  });

  // What: without a `now` option the profiler times with performance.now().
  // Why: that's the default every host gets; it has to produce a finite, non-negative
  // elapsed time without any setup.
  it("uses performance.now() when no clock is given", () => {
    const profiler = createPreparationProfiler();

    profiler.start({ label: "Default clock", kind: "fresh-context" });
    profiler.finish("ready");

    const elapsed = profiler.snapshot()!.elapsedMs;

    expect(Number.isFinite(elapsed) && elapsed >= 0).toBe(true);
  });

  // What: while a run is loading, each stage's total includes only its own unfinished
  // spans, measured up to now.
  // Why: the LOADING view shows live totals during a load. Pending time from one stage
  // leaking into another would blame the wrong stage for a slow load.
  it("adds pending time only to the stage that owns it", () => {
    let now = 0;

    const profiler = createPreparationProfiler({ now: () => now });

    profiler.start({ label: "Pending", kind: "fresh-context" });
    profiler.begin("fetch");

    now = 5;

    profiler.begin("warmup");

    now = 8;

    const snapshot = profiler.snapshot()!;

    expect(snapshot).toMatchObject({ status: "loading", pending: 2 });
    expect(
      snapshot.stages.map((stage) => [stage.stage, stage.totalMs]),
    ).toEqual([
      ["fetch", 8],
      ["warmup", 3],
    ]);
  });
});

describe("cache and byte counters", () => {
  // What: cache outcomes are counted per kind, and only whole, non-negative byte counts
  // are added.
  // Why: these counters come straight from host code, such as a Content-Length header or
  // a loader's progress event. A NaN, negative or fractional value must be dropped rather
  // than poison a total that is shown to the user and exported.
  it("counts cache outcomes and ignores invalid byte counts", () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.start({ label: "Counters", kind: "repeat-session" });
    profiler.cache("texture-decode", "hit");
    profiler.cache("texture-decode", "hit");
    profiler.cache("texture-decode", "miss");
    profiler.cache("texture-decode", "inflight");
    profiler.bytes("fetch", 100);
    profiler.bytes("fetch", -1);
    profiler.bytes("fetch", 1.5);
    profiler.bytes("fetch", Number.NaN);
    profiler.bytes("fetch", Number.MAX_SAFE_INTEGER + 1);

    const stages = profiler.snapshot()!.stages;

    expect(stages.find((stage) => stage.stage === "fetch")).toMatchObject({
      bytes: 100,
    });
    expect(
      stages.find((stage) => stage.stage === "texture-decode"),
    ).toMatchObject({ cacheHits: 2, cacheMisses: 1, cacheInflight: 1 });
  });
});

describe("finished runs", () => {
  // What: history keeps the last eight finished runs, oldest first, and returns copies.
  // Why: the panel lists recent sessions to compare cold and warm loads. The list must stay
  // bounded in a long editor session, and a caller changing a returned snapshot must not
  // alter what the profiler reports next time.
  it("keeps the eight most recent runs as detached copies", () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    for (let run = 1; run <= 10; run++) {
      profiler.start({ label: `Run ${run}`, kind: "repeat-session" });
      profiler.finish("ready");
    }

    const history = profiler.history();

    expect(history.map((run) => run.label)).toEqual([
      "Run 3",
      "Run 4",
      "Run 5",
      "Run 6",
      "Run 7",
      "Run 8",
      "Run 9",
      "Run 10",
    ]);

    Object.assign(history[0]!, { label: "changed" });

    expect(profiler.history()[0]!.label).toBe("Run 3");
  });

  // What: a run's label is cut to 240 characters.
  // Why: labels come from host code and end up in exported recordings, whose format
  // rejects longer labels. Cutting them here keeps every export loadable in the viewer.
  it("cuts long labels to 240 characters", () => {
    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.start({ label: "x".repeat(300), kind: "fresh-context" });

    expect(profiler.snapshot()!.label).toHaveLength(240);
  });
});

describe("measurePreparation", () => {
  // What: with no recorder it only runs the work; with one it measures the work.
  // Why: hosts call it unconditionally in their loading code. When profiling is off it
  // must cost nothing beyond the call itself and still return the work's value.
  it("runs work directly without a recorder and measures it with one", () => {
    expect(measurePreparation(undefined, "fetch", () => 7)).toBe(7);

    const profiler = createPreparationProfiler({ now: () => 0 });

    profiler.start({ label: "Helper", kind: "fresh-context" });

    expect(measurePreparation(profiler, "fetch", () => 8)).toBe(8);
    expect(profiler.snapshot()!.stages[0]).toMatchObject({
      stage: "fetch",
      count: 1,
    });
  });
});
