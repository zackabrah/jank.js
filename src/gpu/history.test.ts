import { afterEach, expect, test, vi } from "vitest";
import { recordingFixture } from "../recording/fixtures.ts";
import { gpuFixture } from "./fixtures.ts";
import { createGpuHistory } from "./history.ts";

afterEach(() => vi.useRealTimers());

test("keeps owned, bounded pre-trigger history and joins late out-of-order results by ID", () => {
  const history = createGpuHistory(3);
  history.record(gpuFixture(1, "pending"));
  history.record(gpuFixture(2));
  history.record(gpuFixture(1));
  expect(history.read([1])[0]?.invocations[0]?.state).toBe("timed");
  const copy = history.read([1]);
  if (copy[0]) copy[0].omitted = 100;
  expect(history.read([1])[0]?.omitted).toBe(0);
  history.record(gpuFixture(4));
  history.record(gpuFixture(1));
  expect(history.read([1, 2, 3, 4]).map((f) => f.frameId)).toEqual([2, 4]);
  expect(history.coverage([1, 2, 3, 4])).toMatchObject({ total: 4, complete: 2, missing: 2 });
});

test("drains only the fixed capture window, retaining history and delayed zero results", async () => {
  vi.useFakeTimers();
  const history = createGpuHistory();
  const recording = recordingFixture();
  const ids = recording.frames.map((f) => f.id);
  for (const id of ids) history.record(gpuFixture(id, "pending"));
  const result = history.finalize(recording, new AbortController().signal);
  history.record(gpuFixture(999));
  for (const id of ids.toReversed()) history.record(gpuFixture(id));
  await vi.advanceTimersByTimeAsync(16);
  expect((await result).frames.map((f) => f.frameId)).toEqual(ids);
  expect((await result).frames.every((f) => f.invocations[0]?.milliseconds === 0)).toBe(true);
});

test("bounds finalization and records timeout reasons without rewriting the live history", async () => {
  vi.useFakeTimers();
  const history = createGpuHistory();
  const recording = recordingFixture();
  const id = recording.frames[0]?.id ?? 1;
  history.record(gpuFixture(id, "pending"));
  const result = history.finalize(recording, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(520);
  expect((await result).frames[0]?.invocations[0]).toMatchObject({
    state: "rejected",
    milliseconds: null,
  });
  expect((await result).frames[0]?.invocations[0]?.reason).toContain("deadline");
  expect(history.read([id])[0]?.invocations[0]?.state).toBe("pending");
});

test("cancels discarded captures and rejects stale completions after an epoch change", async () => {
  const history = createGpuHistory();
  history.record({ ...gpuFixture(1), epoch: 1 });
  history.record(gpuFixture(1, "rejected"));
  expect(history.read([1])[0]?.epoch).toBe(1);
  const abort = new AbortController();
  abort.abort();
  await expect(history.finalize(recordingFixture(), abort.signal)).rejects.toThrow();
});
