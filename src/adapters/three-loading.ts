import type { LoadingManager } from "three";
import type { LoadingOperation, LoadingSession, LoadingSnapshot } from "../loading/model.ts";

type Operation = { -readonly [Key in keyof LoadingOperation]: LoadingOperation[Key] } & {
  ambiguous: boolean;
};
type Stage = {
  operations: Operation[];
  bytes?: number;
  compileProgress?: { completed: number; total: number };
};
type Run = {
  id: number;
  label: string;
  kind: LoadingSession["kind"];
  comparisonKey: string | null;
  start: number;
  stages: Map<string, Stage>;
  sealed: LoadingSession | null;
};

/** Observe one explicitly owned manager. The host owns session boundaries and aborts. */
export function observeThreeLoading(
  manager: Pick<LoadingManager, "itemStart" | "itemEnd" | "itemError">,
  clock = () => performance.now(),
) {
  const original = {
    itemStart: manager.itemStart,
    itemEnd: manager.itemEnd,
    itemError: manager.itemError,
  };
  const pending = new Map<string, ({ run: Run; operation: Operation } | null)[]>();
  const history: LoadingSession[] = [];
  let current: Run | null = null;
  let id = 0,
    operationId = 0,
    lastTime = 0;
  let disposed = false;
  const now = () => {
    const value = clock();
    if (Number.isFinite(value)) lastTime = Math.max(lastTime, value);
    return lastTime;
  };
  const stageFor = (run: Run, name: string) => {
    if (!name.trim()) throw new Error("Loading stages need a name");
    let stage = run.stages.get(name);
    if (!stage) {
      stage = { operations: [] };
      run.stages.set(name, stage);
    }
    return stage;
  };
  const begin = (run: Run, name: string) => {
    const operation: Operation = {
      id: String(++operationId),
      startMs: now() - run.start,
      endMs: null,
      status: "running",
      ambiguous: false,
    };
    stageFor(run, name).operations.push(operation);
    return operation;
  };
  const end = (run: Run, operation: Operation, status: "ready" | "failed" | "cancelled") => {
    if (disposed || run.sealed || operation.status !== "running") return;
    operation.endMs = now() - run.start;
    operation.status = status;
  };
  const snapshot = (run: Run): LoadingSession =>
    run.sealed ?? {
      id: run.id,
      label: run.label,
      kind: run.kind,
      comparisonKey: run.comparisonKey,
      status: "loading",
      elapsedMs: now() - run.start,
      pending: [...run.stages.values()].reduce(
        (sum, stage) =>
          sum + stage.operations.filter((operation) => operation.status === "running").length,
        0,
      ),
      stages: [...run.stages].map(([stage, value]) => ({
        stage,
        count: value.operations.length,
        errors: value.operations.filter((operation) => operation.status === "failed").length,
        cancelled: value.operations.filter((operation) => operation.status === "cancelled").length,
        ...(value.bytes !== undefined ? { bytes: value.bytes } : {}),
        ...(value.compileProgress ? { compileProgress: { ...value.compileProgress } } : {}),
        operations: value.operations
          .filter((operation) => !operation.ambiguous)
          .map(({ id: key, startMs, endMs, status }) => ({ id: key, startMs, endMs, status })),
      })),
    };
  const finish = (run: Run, status: "ready" | "failed" | "cancelled", failure?: string) => {
    if (disposed || run.sealed) return;
    const value = snapshot(run);
    if (
      status === "ready" &&
      (value.pending || value.stages.some((stage) => stage.errors || stage.cancelled))
    )
      throw new Error("A ready loading session must have successful, settled work");
    run.sealed = { ...value, status, ...(failure ? { failure: failure.slice(0, 1000) } : {}) };
    history.push(run.sealed);
    if (history.length > 8) history.shift();
  };
  const itemStart = function (this: typeof manager, url: string) {
    if (!disposed) {
      const item =
        current && !current.sealed ? { run: current, operation: begin(current, "assets") } : null;
      const queue = pending.get(url) ?? [];
      // URL-only callbacks cannot pair overlapping same-URL operations reliably.
      if (queue.length) {
        if (item) item.operation.ambiguous = true;
        for (const previous of queue) if (previous) previous.operation.ambiguous = true;
      }
      queue.push(item);
      pending.set(url, queue);
    }
    return original.itemStart.call(this, url);
  };
  const itemEnd = function (this: typeof manager, url: string) {
    const queue = pending.get(url);
    const item = queue?.shift();
    if (item) end(item.run, item.operation, "ready");
    if (!queue?.length) pending.delete(url);
    return original.itemEnd.call(this, url);
  };
  const itemError = function (this: typeof manager, url: string) {
    const item = pending.get(url)?.find((entry) => entry?.operation.status === "running");
    if (item) end(item.run, item.operation, "failed");
    return original.itemError.call(this, url);
  };
  manager.itemStart = itemStart;
  manager.itemEnd = itemEnd;
  manager.itemError = itemError;
  return {
    start(options: { label: string; kind: LoadingSession["kind"]; comparisonKey?: string }) {
      if (disposed) throw new Error("Loading observer has been disposed");
      if (pending.size || (current && !current.sealed))
        throw new Error("Finish and drain the previous loading session first");
      const run: Run = {
        ...options,
        comparisonKey: options.comparisonKey ?? null,
        id: ++id,
        start: now(),
        stages: new Map(),
        sealed: null,
      };
      current = run;
      return {
        async measure<T>(stage: string, work: () => T | Promise<T>): Promise<T> {
          if (disposed || run.sealed) throw new Error("Loading session has ended");
          const operation = begin(run, stage);
          try {
            const value = await work();
            end(run, operation, "ready");
            return value;
          } catch (error) {
            end(
              run,
              operation,
              error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
            );
            throw error;
          }
        },
        bytes(stage: string, received: number) {
          if (disposed || run.sealed) return;
          const value = stageFor(run, stage);
          const total = (value.bytes ?? 0) + received;
          if (!Number.isSafeInteger(received) || received < 0 || !Number.isSafeInteger(total))
            throw new RangeError("Invalid received bytes");
          value.bytes = total;
        },
        compileProgress(completed: number, total: number) {
          if (
            disposed ||
            run.sealed ||
            !Number.isSafeInteger(completed) ||
            !Number.isSafeInteger(total) ||
            completed < 0 ||
            completed > total
          )
            return;
          stageFor(run, "compile").compileProgress = { completed, total };
        },
        finish: (status: "ready" | "failed" | "cancelled", failure?: string) =>
          finish(run, status, failure),
      };
    },
    read(): LoadingSnapshot {
      return structuredClone({ current: current ? snapshot(current) : null, history });
    },
    dispose() {
      if (disposed) return;
      if (current && !current.sealed) finish(current, "cancelled");
      disposed = true;
      if (manager.itemStart === itemStart) manager.itemStart = original.itemStart;
      if (manager.itemEnd === itemEnd) manager.itemEnd = original.itemEnd;
      if (manager.itemError === itemError) manager.itemError = original.itemError;
      pending.clear();
    },
  };
}
