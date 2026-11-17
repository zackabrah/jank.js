import { expect, test } from "vitest";
import { loadingFixture } from "./fixtures.ts";
import { type LoadingSession, type LoadingStage, readLoading } from "./model.ts";
import { cacheSummary, coldComparison, stageTiming } from "./timing.ts";

const sample: LoadingSession = {
  id: 1,
  label: "test",
  kind: "fresh-context",
  comparisonKey: "test/backend/settings",
  status: "ready",
  elapsedMs: 20,
  pending: 0,
  stages: [
    {
      stage: "fetch",
      count: 4,
      errors: 0,
      cancelled: 0,
      operations: [
        { id: "a", startMs: 0, endMs: 10, status: "ready" },
        { id: "b", startMs: 5, endMs: 15, status: "ready" },
        { id: "c", startMs: 18, endMs: 20, status: "ready" },
        { id: "d", startMs: 20, endMs: 20, status: "ready" },
      ],
    },
  ],
};
function read(current: LoadingSession) {
  const model = readLoading({ current, history: [] });
  if (!model?.latest) throw new Error("Missing session");
  return model.latest;
}
function timing(current: LoadingSession) {
  const session = read(current);
  const stage = session.stages[0];
  if (!stage) throw new Error("Missing stage");
  return stageTiming(stage, session.elapsedMs);
}

test("preserves overlap, gaps and zero-duration operations without adding wall time twice", () => {
  const result = timing(sample);
  expect(result.all).toMatchObject([
    { start: 0, end: 15 },
    { start: 18, end: 20 },
  ]);
  expect(result).toMatchObject({ wallMs: 17, totalMs: 22, missing: 0 });
  expect(read(sample).elapsedMs).toBe(20);
});

test("running tails end at the host cutoff and missing clocks never imply a zero duration", () => {
  const cancelled: LoadingSession = {
    ...sample,
    status: "cancelled",
    elapsedMs: 16,
    pending: 1,
    stages: [
      {
        stage: "fetch",
        count: 3,
        errors: 0,
        cancelled: 1,
        operations: [
          { id: "a", startMs: 0, endMs: 10, status: "ready" },
          { id: "b", startMs: 12, endMs: 13, status: "cancelled" },
          { id: "c", startMs: 8, endMs: null, status: "running" },
        ],
      },
    ],
  };
  expect(timing(cancelled)).toMatchObject({
    running: [{ start: 8, end: 16 }],
    wallMs: 16,
    totalMs: 19,
  });
  expect(timing({ ...cancelled, elapsedMs: null })).toMatchObject({
    running: [],
    missing: 1,
    wallMs: null,
    totalMs: null,
  });
});

test("aggregate durations do not fabricate bars and partial timings do not become complete totals", () => {
  const stage = sample.stages[0];
  if (!stage) throw new Error("Missing stage");
  const partial = {
    ...sample,
    stages: [{ ...stage, operations: stage.operations?.slice(0, 1) ?? [] }],
  };
  expect(timing(partial)).toMatchObject({
    all: [{ start: 0, end: 10 }],
    missing: 3,
    wallMs: null,
    totalMs: null,
  });
  expect(
    timing({ ...sample, stages: [{ ...stage, operations: null, busyMs: 17, totalMs: 22 }] }),
  ).toMatchObject({ all: [], missing: 4, wallMs: 17, totalMs: 22 });
  expect(
    timing({ ...sample, elapsedMs: 0, stages: [{ ...stage, count: 0, operations: [] }] }),
  ).toMatchObject({ missing: 0, wallMs: 0, totalMs: 0 });
});

test("cold comparisons require explicit matching groups, earlier success and a complete warm run", () => {
  const model = readLoading(loadingFixture("ready"));
  if (!model?.latest) throw new Error("Missing fixture");
  expect(coldComparison(model.latest, model)).toMatchObject({ cold: { id: 1 }, delta: -116 });
  expect(coldComparison(model.latest, model).percent).toBeCloseTo(-28.1553);
  for (const scenario of ["loading", "failed", "cancelled", "unknown"] as const) {
    const state = readLoading(loadingFixture(scenario));
    if (!state?.latest) throw new Error("Missing fixture");
    expect(coldComparison(state.latest, state)).toMatchObject({
      cold: { id: 1 },
      delta: null,
      percent: null,
    });
  }
  for (const patch of [
    { comparisonKey: null },
    { comparisonKey: "other" },
    { id: 1 },
    { kind: "editor" as const },
  ])
    expect(coldComparison({ ...model.latest, ...patch }, model).cold).toBeNull();
  const failedCold = {
    ...model,
    sessions: model.sessions.map((session) => ({ ...session, status: "failed" as const })),
  };
  expect(coldComparison(model.latest, failedCold).cold).toBeNull();
  expect(coldComparison({ ...model.latest, elapsedMs: 500 }, model).delta).toBe(88);
  const coldZero = read({ ...sample, elapsedMs: 0, stages: [] });
  const warmZero = { ...coldZero, id: 2, kind: "repeat-session" as const, elapsedMs: 5 };
  expect(
    coldComparison(warmZero, { sessions: [coldZero, warmZero], latest: warmZero }),
  ).toMatchObject({ delta: 5, percent: null });
});

test("cache percentages count shared requests and distinguish zero lookups from missing data", () => {
  const current = loadingFixture("ready").current;
  if (!current) throw new Error("Missing fixture");
  expect(cacheSummary(read(current))).toEqual({ hits: 2, total: 20, percent: 10 });
  expect(
    cacheSummary(
      read({
        ...current,
        stages: current.stages.map((stage) => ({
          ...stage,
          cacheHits: 0,
          cacheMisses: 0,
          cacheInflight: 0,
        })),
      }),
    ),
  ).toEqual({ hits: 0, total: 0, percent: null });
  expect(cacheSummary(read(sample))).toBeNull();
  expect(
    cacheSummary(
      read({ ...current, stages: current.stages.map((stage) => ({ ...stage, cacheHits: null })) }),
    ),
  ).toBeNull();
});

test("rejects contradictory offsets/outcomes/cache values and owns copied operation data", () => {
  const stage = sample.stages[0];
  const operation = stage?.operations?.[0];
  if (!stage || !operation) throw new Error("Missing fixture");
  for (const patch of [
    { id: "" },
    { startMs: -1 },
    { endMs: 21 },
    { endMs: NaN },
    { startMs: 11 },
    { status: "running" },
    { endMs: null },
    { status: "failed" },
  ])
    expect(() =>
      read({
        ...sample,
        stages: [{ ...stage, operations: [{ ...operation, ...patch }] } as LoadingStage],
      }),
    ).toThrow(RangeError);
  expect(() =>
    read({ ...sample, stages: [{ ...stage, operations: [operation, operation] }] }),
  ).toThrow(/identity/);
  expect(() =>
    read({
      ...sample,
      stages: [{ ...stage, operations: [{ ...operation, status: "running", endMs: null }] }],
    }),
  ).toThrow(/outcomes/);
  for (const patch of [
    { cacheHits: -1 },
    { cacheMisses: 1.2 },
    { bytes: Infinity },
    { busyMs: NaN },
    { totalMs: -1 },
  ])
    expect(() => read({ ...sample, stages: [{ ...stage, ...patch }] })).toThrow(RangeError);
  expect(() => read({ ...sample, comparisonKey: " " })).toThrow(RangeError);
  const mutable = { ...operation };
  const detached = read({ ...sample, stages: [{ ...stage, operations: [mutable] }] });
  mutable.endMs = 19;
  expect(detached.stages[0]?.operations[0]?.endMs).toBe(10);
  const progress = { completed: 1, total: 2 };
  const withProgress = read({ ...sample, stages: [{ ...stage, compileProgress: progress }] });
  progress.completed = 2;
  expect(withProgress.stages[0]?.compileProgress?.completed).toBe(1);
  expect(() =>
    read({ ...sample, stages: [{ ...stage, compileProgress: { completed: 3, total: 2 } }] }),
  ).toThrow(/compilation progress/);
});
