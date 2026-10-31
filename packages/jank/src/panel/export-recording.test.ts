import { describe, expect, it, vi } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { createProfiler } from "../browser/create-profiler.ts";
import type { GpuFrameResolution } from "../core/gpu.ts";
import { createRecordingExporter } from "./export-recording.ts";

function host() {
  let nowMs = 0;
  const profiler = createProfiler({ now: () => nowMs });
  function record() {
    profiler.capture.start();
    for (let index = 0; index < 3; index += 1) {
      profiler.beginFrame(nowMs);
      nowMs += 16;
    }
  }
  return { profiler, record };
}
const resolved = (ids: readonly number[]): GpuFrameResolution => ({
  status: "settled",
  pendingFrameIds: [],
  samples: ids.map((frameId) => ({ ...gpuIntervalFixture(), frameId, sequence: frameId })),
});

describe("panel recording exports", () => {
  it("stops the active capture, merges only its sealed frames, and suppresses duplicate clicks", async () => {
    const { profiler, record } = host();
    record();
    profiler.capture.stop();
    record();
    const pending = Promise.withResolvers<GpuFrameResolution>();
    const resolver = { resolveFrames: vi.fn(() => pending.promise) };
    const save = vi.fn();
    const exporter = createRecordingExporter({ profiler, resolver, save, changed: vi.fn() });
    const waiting = exporter.export();
    expect(profiler.capture.getState().status).toBe("idle");
    expect(exporter.state().busy).toBe(true);
    await exporter.export();
    await Promise.resolve();
    const ids = profiler.capture.read(2)?.frames.map((frame) => frame.id) ?? [];
    expect(resolver.resolveFrames).toHaveBeenCalledTimes(1);
    expect(resolver.resolveFrames).toHaveBeenCalledWith(ids, { timeoutMs: 2000 });
    pending.resolve(resolved(ids));
    await waiting;
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].frames.map((frame: { id: number }) => frame.id)).toEqual(ids);
    expect(save.mock.calls[0]?.[0].gpu).toHaveLength(ids.length);
    expect(exporter.notice(2)).toContain("100.0%");
    expect(exporter.state().message).toContain("Download requested");
    expect(profiler.capture.read(2)?.gpu).toEqual([]);
  });
  it.each(["clear", "dispose"] as const)(
    "%s suppresses late downloads without disposing the borrowed resolver",
    async (action) => {
      const { profiler, record } = host();
      record();
      const pending = Promise.withResolvers<GpuFrameResolution>();
      const save = vi.fn();
      const exporter = createRecordingExporter({
        profiler,
        resolver: { resolveFrames: () => pending.promise },
        save,
        changed: vi.fn(),
      });
      const waiting = exporter.export();
      exporter[action]();
      pending.resolve(resolved([1, 2]));
      await waiting;
      expect(save).not.toHaveBeenCalled();
      expect(exporter.state().message).toBe("");
    },
  );
  it("retains merged data for retry after a download failure", async () => {
    const { profiler, record } = host();
    record();
    const resolver = { resolveFrames: vi.fn(async (ids: readonly number[]) => resolved(ids)) };
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error("Downloads blocked");
    });
    const exporter = createRecordingExporter({ profiler, resolver, save, changed: vi.fn() });
    await expect(exporter.export()).rejects.toThrow("Downloads blocked");
    expect(exporter.state().busy).toBe(false);
    expect(exporter.notice(1)).toContain("Download failed");
    resolver.resolveFrames.mockImplementation(async () => resolved([]));
    await exporter.export(1);
    expect(save.mock.calls[1]?.[0].gpu).toHaveLength(2);
    expect(exporter.notice(1)).toContain("100.0%");
  });
  it("exports without a resolver without claiming finalization or truncating CPU-only data", async () => {
    const { profiler, record } = host();
    record();
    const save = vi.fn();
    const exporter = createRecordingExporter({ profiler, save, changed: vi.fn() });
    await exporter.export();
    expect(save.mock.calls[0]?.[0].truncated).toBe(false);
    expect(exporter.state().message).toContain("No GPU resolver");
    expect(exporter.state().message).toContain("2 without interval evidence");
    await expect(exporter.export(99)).rejects.toThrow("no longer retained");
    expect(() =>
      createRecordingExporter({ profiler, save, changed: vi.fn(), timeoutMs: -1 }),
    ).toThrow(RangeError);
  });
  it("reports timeout and resolver errors while still exporting available evidence", async () => {
    const { profiler, record } = host();
    record();
    const save = vi.fn();
    const exporter = createRecordingExporter({
      profiler,
      save,
      changed: vi.fn(),
      timeoutMs: 0,
      resolver: { resolveFrames: () => new Promise(() => {}) },
    });
    await exporter.export();
    expect(exporter.state().message).toContain("timed out");
    expect(save.mock.calls[0]?.[0].truncated).toBe(true);
    const failing = createRecordingExporter({
      profiler,
      save,
      changed: vi.fn(),
      resolver: {
        resolveFrames: async () => {
          throw new Error("Device lost");
        },
      },
    });
    await failing.export();
    expect(failing.state().message).toContain("Device lost");
  });
});

it("an invalidated export cannot unlock a newer export, and externally cleared captures are not downloaded", async () => {
  const { profiler, record } = host();
  const first = Promise.withResolvers<GpuFrameResolution>();
  const second = Promise.withResolvers<GpuFrameResolution>();
  const resolver = {
    resolveFrames: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
  };
  const save = vi.fn();
  const exporter = createRecordingExporter({ profiler, resolver, save, changed: vi.fn() });
  record();
  const oldExport = exporter.export();
  exporter.clear();
  record();
  const newExport = exporter.export();
  first.resolve(resolved([1, 2]));
  await oldExport;
  expect(exporter.state().busy).toBe(true);
  expect(save).not.toHaveBeenCalled();
  profiler.clear();
  second.resolve(resolved([]));
  await newExport;
  expect(exporter.state().busy).toBe(false);
  expect(exporter.state().message).toContain("cleared or evicted");
  expect(save).not.toHaveBeenCalled();
});

it("retries the same recent-history file after a failed download, then resumes fresh exports", async () => {
  const { profiler } = host();
  profiler.beginFrame(0);
  profiler.beginFrame(16);
  profiler.beginFrame(32);
  const save = vi.fn().mockImplementationOnce(() => {
    throw new Error("Blocked");
  });
  const exporter = createRecordingExporter({ profiler, save, changed: vi.fn() });
  await expect(exporter.export()).rejects.toThrow("Blocked");
  profiler.beginFrame(48);
  await exporter.export();
  expect(save.mock.calls[1]?.[0].frames).toHaveLength(2);
  await exporter.export();
  expect(save.mock.calls[2]?.[0].frames).toHaveLength(3);
});
