import { describe, expect, it } from "vitest";
import { createLoadingProfilerRuntime } from "./profiler.ts";

function fixture(limits = {}) {
  let time = 0;
  const loading = createLoadingProfilerRuntime({ now: () => time, ...limits });
  return {
    loading,
    at: (value: number) => {
      time = value;
    },
  };
}
const fresh = { label: "Level", kind: "fresh-context" } as const;

describe("loading run ownership", () => {
  it("measures overlapping operations, live intervals, outcomes, bytes and cache without summing wall time", () => {
    const { loading, at } = fixture();
    expect(loading.snapshot()).toBeNull();
    const run = loading.beginRun(fresh);
    const first = run.startStage("fetch");
    first.addReceivedBytes(80);
    first.recordCache("miss");
    at(5);
    const second = run.startStage("fetch");
    second.recordCache("in-flight");
    at(10);
    first.finish();
    at(15);
    expect(loading.snapshot()?.stages[0]).toMatchObject({
      totalMs: 20,
      busyMs: 15,
      operationCount: 2,
    });
    second.addReceivedBytes(20);
    second.finish("failed");
    at(20);
    const third = run.startStage("fetch");
    third.recordCache("hit");
    at(25);
    third.finish("cancelled");
    run.finish("failed");
    at(100);
    expect(loading.snapshot()).toMatchObject({
      elapsedMs: 25,
      pendingOperations: 0,
      status: "failed",
      stages: [
        {
          totalMs: 25,
          busyMs: 20,
          failedCount: 1,
          cancelledCount: 1,
          receivedBytes: 100,
          cache: { hits: 1, misses: 1, inFlight: 1 },
        },
      ],
    });
    expect(loading.baseline()).toBeNull();
  });

  it("seals pending work at replacement and ignores every stale handle mutation", () => {
    const { loading, at } = fixture();
    const old = loading.beginRun(fresh);
    const operation = old.startStage("decode");
    at(12);
    const next = loading.beginRun({ label: "Next", kind: "repeat-session" });
    operation.finish();
    operation.addReceivedBytes(100);
    operation.recordCache("hit");
    old.startStage("late").finish();
    old.finish("ready");
    expect(loading.history()).toMatchObject([
      {
        status: "cancelled",
        elapsedMs: 12,
        pendingOperations: 1,
        stages: [{ totalMs: 12, busyMs: 12 }],
      },
    ]);
    expect(loading.snapshot()?.stages).toEqual([]);
    at(20);
    next.finish("ready");
    next.finish("failed");
    expect(loading.history()).toHaveLength(2);
  });

  it("retains a detached first successful cold baseline beyond bounded history and clears without recycling ids", () => {
    const { loading, at } = fixture({ historyCapacity: 2 });
    loading.beginRun(fresh).finish("failed");
    const cold = loading.beginRun(fresh);
    const op = cold.startStage("fetch");
    op.recordCache("miss");
    at(10);
    op.finish();
    cold.finish("ready");
    const detached = loading.snapshot();
    if (detached) {
      Object.assign(detached.stages[0]?.cache ?? {}, { hits: 999 });
    }
    loading.beginRun(fresh).finish("ready");
    loading.beginRun({ label: "Editor", kind: "editor" }).finish("ready");
    expect(loading.history().map((run) => run.id)).toEqual([3, 4]);
    expect(loading.baseline()).toMatchObject({
      id: 2,
      elapsedMs: 10,
      stages: [{ cache: { hits: 0 } }],
    });
    const history = loading.history();
    Object.assign(history[0] ?? {}, { label: "changed" });
    expect(loading.history()[0]?.label).toBe("Level");
    const baseline = loading.baseline();
    Object.assign(baseline ?? {}, { label: "changed" });
    expect(loading.baseline()?.label).toBe("Level");
    const stale = loading.beginRun(fresh).startStage("pending");
    loading.clear();
    stale.finish();
    expect(loading.history()).toEqual([]);
    expect(loading.baseline()).toBeNull();
    expect(loading.snapshot()).toBeNull();
    loading.beginRun(fresh);
    expect(loading.snapshot()?.id).toBe(6);
    loading.dispose();
    loading.dispose();
    loading.clear();
    expect(loading.snapshot()).toBeNull();
    expect(() => loading.beginRun(fresh)).toThrow(/disposed/);
  });

  it("preserves synchronous values and async rejections while recording failures and cancellation", async () => {
    const { loading, at } = fixture();
    const run = loading.beginRun(fresh);
    expect(
      run.measure("prepare", () => {
        at(4);
        return 42;
      }),
    ).toBe(42);
    const error = new Error("decode failed");
    expect(() =>
      run.measure("decode", () => {
        throw error;
      }),
    ).toThrow(error);
    await expect(
      run.measure("fetch", () => Promise.reject({ name: "AbortError" })),
    ).rejects.toEqual({ name: "AbortError" });
    await expect(
      run.measure("fetch", async () => {
        at(10);
        return "ok";
      }),
    ).resolves.toBe("ok");
    await expect(run.measure("decode", () => Promise.reject(error))).rejects.toBe(error);
    run.finish("failed");
    expect(loading.snapshot()?.stages).toMatchObject([
      { totalMs: 4 },
      { failedCount: 2 },
      { cancelledCount: 1 },
    ]);
  });

  it("rejects invalid clocks, labels, outcomes, counts and capacities before changing retained measurements", () => {
    for (const key of ["maxStages", "maxOperations", "historyCapacity"]) {
      expect(() => fixture({ [key]: 0 })).toThrow(/positive integer/);
    }
    const { loading, at } = fixture({ maxStages: 1, maxOperations: 2 });
    expect(() => loading.beginRun({ ...fresh, label: " " })).toThrow(/label/);
    const run = loading.beginRun(fresh);
    expect(() => run.startStage("")).toThrow(/stage/);
    const op = run.startStage("fetch");
    expect(() => run.startStage("decode")).toThrow(/stage capacity/);
    run.startStage("fetch").finish();
    expect(() => run.startStage("fetch")).toThrow(/operation capacity/);
    for (const bytes of [-1, NaN, Infinity, 0.5]) {
      expect(() => op.addReceivedBytes(bytes)).toThrow(/bytes/);
    }
    op.addReceivedBytes(Number.MAX_SAFE_INTEGER);
    expect(() => op.addReceivedBytes(1)).toThrow(/bytes/);
    at(-1);
    expect(() => op.finish()).toThrow(/clock/);
    at(NaN);
    expect(() => loading.snapshot()).toThrow(/clock/);
    at(3);
    op.finish();
    op.finish();
    run.finish("ready");
    expect(loading.snapshot()?.elapsedMs).toBe(3);
  });
});

it("runs the public default clock and preserves late promise results without changing replacement history", async () => {
  const { createLoadingProfiler } = await import("../browser/create-loading-profiler.ts");
  const real = createLoadingProfiler();
  real.beginRun(fresh).finish("ready");
  expect(real.snapshot()?.elapsedMs).toBeGreaterThanOrEqual(0);
  real.dispose();
  const custom = createLoadingProfiler({ now: () => 1 });
  custom.beginRun(fresh).finish("ready");
  expect(custom.snapshot()?.elapsedMs).toBe(0);
  custom.dispose();
  const { loading, at } = fixture();
  const run = loading.beginRun(fresh);
  let resolve: (value: number) => void = () => {};
  const promise = new Promise<number>((done) => {
    resolve = done;
  });
  const measured = run.measure("fetch", () => promise);
  at(9);
  loading.beginRun(fresh);
  resolve(7);
  await expect(measured).resolves.toBe(7);
  expect(loading.history()[0]?.pendingOperations).toBe(1);
  expect(loading.snapshot()?.stages).toEqual([]);
  const stale = run.startStage("ignored");
  stale.addReceivedBytes(1);
  stale.recordCache("hit");
  expect(run.measure("ignored", () => null)).toBeNull();
});

it("rejects invalid discriminants without sealing or changing the current run", () => {
  const { loading } = fixture();
  const run = loading.beginRun(fresh);
  // @ts-expect-error Runtime callers may provide invalid discriminants.
  expect(() => loading.beginRun({ label: "Invalid", kind: "cold" })).toThrow(/kind/);
  const op = run.startStage("fetch");
  // @ts-expect-error Runtime outcome validation precedes mutations.
  expect(() => op.finish("invalid")).toThrow(/outcome/);
  // @ts-expect-error Runtime cache validation precedes mutations.
  expect(() => op.recordCache("invalid")).toThrow(/outcome/);
  // @ts-expect-error Runtime outcome validation precedes mutations.
  expect(() => run.finish("invalid")).toThrow(/outcome/);
  expect(loading.snapshot()?.status).toBe("loading");
  op.finish();
  op.addReceivedBytes(5);
  op.recordCache("hit");
  expect(loading.snapshot()?.stages[0]?.receivedBytes).toBe(0);
  run.finish("ready");
});
