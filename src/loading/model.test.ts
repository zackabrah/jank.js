import { expect, test } from "vitest";
import { loadingFixture } from "./fixtures.ts";
import { type LoadingSession, readLoading } from "./model.ts";

test("distinguishes a disconnected source, empty history and an active session with no operations", () => {
  expect(readLoading(undefined)).toBeNull();
  expect(readLoading(null)).toBeNull();
  expect(readLoading(loadingFixture("empty"))).toEqual({ sessions: [], latest: null });
  const source = loadingFixture("loading");
  if (!source.current) throw new Error("Missing fixture");
  expect(
    readLoading({
      current: { ...source.current, stages: [], pending: 0, elapsedMs: 0 },
      history: [],
    })?.latest,
  ).toMatchObject({ status: "loading", total: 0, completed: 0, elapsedMs: 0 });
});

test("uses host wall time and keeps successful, failed, cancelled and unfinished outcomes separate", () => {
  const current = loadingFixture("cancelled").current;
  if (!current) throw new Error("Missing fixture");
  const stages = current.stages.map((stage) => ({ ...stage, totalMs: 1000, busyMs: 200 }));
  const result = readLoading({ current: { ...current, stages }, history: [] });
  expect(result?.latest).toMatchObject({
    elapsedMs: 280,
    total: 20,
    completed: 17,
    cancelled: 1,
    pending: 2,
    failed: 0,
  });
  expect(readLoading(loadingFixture("failed"))?.latest).toMatchObject({
    completed: 18,
    failed: 2,
    pending: 0,
    failures: ["textures: 1", "pipelines: 1"],
  });
  expect(readLoading(loadingFixture("unknown"))?.latest?.elapsedMs).toBeNull();
  expect(
    readLoading({ current: { ...current, status: "ready" }, history: [] })?.latest,
  ).toMatchObject({ status: "ready", pending: 2, cancelled: 1 });
});

test("deduplicates current/history, bounds retained history and owns its display data", () => {
  const source = loadingFixture("ready");
  const current = source.current;
  if (!current) throw new Error("Missing fixture");
  const view = readLoading(source);
  expect(view?.sessions).toHaveLength(2);
  const history = Array.from({ length: 12 }, (_, index) => ({ ...current, id: index + 1 }));
  const retained = readLoading({
    current: { ...current, id: 13, status: "loading", pending: 0 },
    history,
  });
  expect(retained?.sessions.map((run) => run.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const replaced = readLoading({
    current: { ...current, elapsedMs: 300 },
    history: source.history,
  });
  expect(replaced?.sessions.at(-1)?.elapsedMs).toBe(300);
  const mutable = { ...current, stages: current.stages.map((stage) => ({ ...stage })) };
  const detached = readLoading({ current: mutable, history: [] });
  mutable.elapsedMs = 900;
  const stage = mutable.stages[0];
  if (stage) stage.errors = 1;
  expect(detached?.latest).toMatchObject({ elapsedMs: 296, failed: 0, failures: [] });
});

test("rejects malformed counts, clocks, outcomes and ambiguous history", () => {
  const current = loadingFixture("loading").current;
  if (!current) throw new Error("Missing fixture");
  for (const patch of [
    { id: 0 },
    { elapsedMs: NaN },
    { elapsedMs: -1 },
    { pending: 21 },
    { pending: 1.5 },
    { stages: [{ stage: "textures", count: 2, errors: 2, cancelled: 1 }] },
    { stages: [{ stage: "", count: 0, errors: 0, cancelled: 0 }] },
    { stages: [current.stages[0], current.stages[0]] },
    {
      stages: [
        { stage: "one", count: Number.MAX_SAFE_INTEGER, errors: 0, cancelled: 0 },
        { stage: "two", count: 1, errors: 0, cancelled: 0 },
      ],
    },
  ]) {
    expect(() =>
      readLoading({ current: { ...current, ...patch } as LoadingSession, history: [] }),
    ).toThrow(RangeError);
  }
  expect(() => readLoading({ current: null, history: [current] })).toThrow(/finished/);
  const ready = { ...current, status: "ready" as const };
  expect(() => readLoading({ current: null, history: [ready, ready] })).toThrow(/unique/);
  expect(() => readLoading({ current: null, history: [ready, { ...ready, id: 1 }] })).toThrow(
    /ordered/,
  );
});
