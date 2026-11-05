import type { LoadingOperation, LoadingSession, LoadingSnapshot } from "./model.ts";

export type LoadingScenario =
  | "empty"
  | "loading"
  | "ready"
  | "failed"
  | "cancelled"
  | "unknown"
  | "missing"
  | "partial"
  | "unmatched";

/** Simulated lifecycle states for tests/review; never used as production measurements. */
export function loadingFixture(scenario: LoadingScenario): LoadingSnapshot {
  if (scenario === "empty") return { current: null, history: [] };
  const cold: LoadingSession = {
    id: 1,
    label: "Harbour scene",
    kind: "fresh-context",
    status: "ready",
    comparisonKey: "harbour/webgpu/default",
    elapsedMs: 412,
    pending: 0,
    stages: [
      {
        stage: "textures",
        count: 8,
        errors: 0,
        cancelled: 0,
        cacheHits: 0,
        cacheMisses: 8,
        cacheInflight: 0,
        bytes: 8 * 1024 ** 2,
        operations: Array.from({ length: 8 }, (_, i) => ({
          id: `texture-${i}`,
          startMs: i * 20,
          endMs: 180 + i * 20,
          status: "ready" as const,
        })),
      },
      {
        stage: "pipelines",
        count: 12,
        errors: 0,
        cancelled: 0,
        cacheHits: 0,
        cacheMisses: 12,
        cacheInflight: 0,
        bytes: 0,
        operations: Array.from({ length: 12 }, (_, i) => ({
          id: `pipeline-${i}`,
          startMs: 320 + i * 4,
          endMs: 368 + i * 4,
          status: "ready" as const,
        })),
      },
    ],
  };
  const status =
    scenario === "loading" || scenario === "failed" || scenario === "cancelled"
      ? scenario
      : "ready";
  let current: LoadingSession = {
    ...cold,
    id: 2,
    kind: "repeat-session",
    status,
    comparisonKey:
      scenario === "unmatched" ? "harbour/webgpu/other-settings" : "harbour/webgpu/default",
    elapsedMs: scenario === "unknown" ? null : status === "ready" ? 296 : 280,
    pending: status === "loading" || status === "cancelled" ? 2 : 0,
    stages: [
      {
        stage: "textures",
        count: 8,
        errors: status === "failed" ? 1 : 0,
        cancelled: 0,
        cacheHits: 2,
        cacheMisses: 5,
        cacheInflight: 1,
        bytes: 8 * 1024 ** 2,
        operations: Array.from(
          { length: 8 },
          (_, i): LoadingOperation => ({
            id: `texture-${i}`,
            startMs: i * 10,
            endMs: 90 + i * 10,
            status: status === "failed" && i === 7 ? "failed" : "ready",
          }),
        ),
      },
      {
        stage: "pipelines",
        count: 12,
        errors: status === "failed" ? 1 : 0,
        cancelled: status === "cancelled" ? 1 : 0,
        cacheHits: 0,
        cacheMisses: 12,
        cacheInflight: 0,
        bytes: 0,
        operations: Array.from({ length: 12 }, (_, i): LoadingOperation => {
          const running = (status === "loading" || status === "cancelled") && i >= 10;
          return {
            id: `pipeline-${i}`,
            startMs: 160 + i * 4,
            endMs: running
              ? null
              : i >= 10
                ? (status === "failed" ? 276 : 292) + (i - 10) * 4
                : 196 + i * 4,
            status: running
              ? "running"
              : status === "failed" && i === 11
                ? "failed"
                : status === "cancelled" && i === 9
                  ? "cancelled"
                  : "ready",
          };
        }),
      },
    ],
    failure:
      status === "failed" ? "Reference texture unavailable; pipeline preparation rejected." : null,
  };
  if (scenario === "missing")
    current = {
      ...current,
      comparisonKey: null,
      stages: current.stages.map((stage) => ({
        stage: stage.stage,
        count: stage.count,
        errors: 0,
        cancelled: 0,
        totalMs: stage.stage === "textures" ? 720 : 544,
        busyMs: stage.stage === "textures" ? 160 : 136,
      })),
    };
  if (scenario === "partial")
    current = {
      ...current,
      stages: current.stages.map((stage) => ({
        ...stage,
        operations: stage.operations?.slice(0, 4) ?? [],
        cacheHits: stage.stage === "pipelines" ? null : (stage.cacheHits ?? null),
      })),
    };
  return { current, history: status === "loading" ? [cold] : [cold, current] };
}
