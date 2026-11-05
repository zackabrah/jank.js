import { LoadingManager } from "three";
import { expect, test, vi } from "vitest";
import { readLoading } from "../loading/model.ts";
import { observeThreeLoading } from "./three-loading.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("measures actual item boundaries, overlaps and bytes while retaining manager callbacks", () => {
  let clock = 100;
  const onLoad = vi.fn(),
    onProgress = vi.fn(),
    onError = vi.fn();
  const manager = new LoadingManager(onLoad, onProgress, onError);
  manager.onStart = vi.fn();
  const original = manager.itemStart;
  const source = observeThreeLoading(manager, () => clock);
  const run = source.start({ label: "scene", kind: "fresh-context", comparisonKey: "scene/one" });
  manager.itemStart("a");
  clock = 105;
  manager.itemStart("b");
  clock = 112;
  manager.itemEnd("a");
  clock = 120;
  manager.itemError("b");
  manager.itemEnd("b");
  run.bytes("assets", 42);
  expect(() => run.finish("ready")).toThrow(/successful/);
  run.finish("failed", "request b failed");
  expect(source.read().current).toMatchObject({
    elapsedMs: 20,
    pending: 0,
    status: "failed",
    stages: [
      {
        count: 2,
        errors: 1,
        bytes: 42,
        operations: [
          { startMs: 0, endMs: 12, status: "ready" },
          { startMs: 5, endMs: 20, status: "failed" },
        ],
      },
    ],
  });
  expect(readLoading(source.read())?.latest).toMatchObject({ completed: 1, failed: 1 });
  expect(onLoad).toHaveBeenCalledOnce();
  expect(onProgress).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledWith("b");
  expect(manager.onStart).toHaveBeenCalledOnce();
  source.dispose();
  source.dispose();
  expect(manager.itemStart).toBe(original);
});

test("seals cancellation cutoffs, ignores late results and waits for manager items to drain", async () => {
  let clock = 0;
  const manager = new LoadingManager();
  const source = observeThreeLoading(manager, () => clock);
  const run = source.start({ label: "first", kind: "editor" });
  manager.itemStart("asset");
  const compilation = deferred<number>();
  const measured = run.measure("compile", () => compilation.promise);
  clock = 10;
  run.compileProgress(1, 3);
  run.finish("cancelled");
  const held = source.read();
  clock = 30;
  run.bytes("assets", 900);
  run.compileProgress(3, 3);
  expect(() => source.start({ label: "next", kind: "editor" })).toThrow(/drain/);
  manager.itemError("asset");
  manager.itemEnd("asset");
  compilation.resolve(7);
  expect(await measured).toBe(7);
  expect(source.read()).toEqual(held);
  expect(held.current).toMatchObject({ status: "cancelled", pending: 2, elapsedMs: 10 });
  source.start({ label: "next", kind: "repeat-session" }).finish("ready");
  expect(source.read().history).toHaveLength(2);
  source.dispose();
});

test("same-URL overlap has honest missing offsets; unscoped items cannot enter a later session", () => {
  const manager = new LoadingManager();
  const source = observeThreeLoading(manager, () => 0);
  manager.itemStart("outside");
  expect(() => source.start({ label: "next", kind: "editor" })).toThrow(/drain/);
  manager.itemEnd("outside");
  const run = source.start({ label: "duplicate", kind: "editor" });
  manager.itemStart("same");
  manager.itemStart("same");
  manager.itemError("same");
  manager.itemEnd("same");
  manager.itemEnd("same");
  run.finish("failed");
  expect(source.read().current?.stages[0]).toMatchObject({ count: 2, errors: 1, operations: [] });
  expect(readLoading(source.read())?.latest).toMatchObject({ completed: 1, failed: 1 });
  source.dispose();
});

test("keeps original results/errors, monotonic clocks, detached progress and bounded history", async () => {
  let clock = 5;
  const manager = new LoadingManager();
  const source = observeThreeLoading(manager, () => clock);
  const run = source.start({ label: "compile", kind: "editor" });
  const error = new Error("compiler rejected");
  clock = 2;
  await expect(
    run.measure("compile", () => {
      throw error;
    }),
  ).rejects.toBe(error);
  run.compileProgress(1, 2);
  run.compileProgress(3, 2);
  clock = NaN;
  run.finish("failed", error.message);
  expect(source.read().current).toMatchObject({
    elapsedMs: 0,
    stages: [{ errors: 1, compileProgress: { completed: 1, total: 2 } }],
  });
  for (let i = 0; i < 10; i++) source.start({ label: "next", kind: "editor" }).finish("ready");
  expect(source.read().history).toHaveLength(8);
  const replacement = vi.fn();
  manager.itemStart = replacement;
  source.dispose();
  expect(manager.itemStart).toBe(replacement);
  expect(() => source.start({ label: "disposed", kind: "editor" })).toThrow(/disposed/);
});
