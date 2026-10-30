import { describe, expect, it, vi } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import type { GpuFrameResolution } from "../core/gpu.ts";
import { parseRecording, serializeRecording } from "../recordings/codec.ts";
import { finalizeRecording } from "./finalize-recording.ts";

function resolution(samples: GpuFrameResolution["samples"] = []): GpuFrameResolution {
  return { status: "settled", samples, pendingFrameIds: [] };
}

describe("GPU capture finalization", () => {
  it("merges late, out-of-order frames without mutating the stopped capture or accepting future frames", async () => {
    const first = gpuIntervalFixture();
    const second = { ...first, frameId: 2, sequence: 2 };
    const recording = { ...recordingFixture(), gpu: [first] };
    const deferred = Promise.withResolvers<GpuFrameResolution>();
    const source = { resolveFrames: vi.fn(() => deferred.promise) };
    const waiting = finalizeRecording(recording, source, { timeoutMs: 100 });
    deferred.resolve(
      resolution([
        second,
        first,
        { ...first, frameId: 3, sequence: 3 },
        { ...first, frameId: null, sequence: 4 },
      ]),
    );
    const result = await waiting;
    expect(source.resolveFrames).toHaveBeenCalledWith([1, 2], { timeoutMs: 100 });
    expect(result).toMatchObject({
      status: "settled",
      complete: true,
      missingFrameIds: [],
      incompleteFrameIds: [],
      error: null,
    });
    expect(result.recording.gpu.map((sample) => sample.frameId)).toEqual([1, 2]);
    expect(recording.gpu).toHaveLength(1);
    Reflect.set(second.passes[0] ?? {}, "label", "changed after resolution");
    expect(result.recording.gpu[1]?.passes[0]?.label).toBe("Ocean FFT");
    const parsed = parseRecording(serializeRecording(result.recording));
    expect(parsed).toEqual({ ok: true, recording: result.recording });
  });

  it("bounds a nonsettling resolver and prevents late mutation after timeout", async () => {
    vi.useFakeTimers();
    try {
      const deferred = Promise.withResolvers<GpuFrameResolution>();
      const recording = { ...recordingFixture(), gpu: [] };
      const waiting = finalizeRecording(
        recording,
        { resolveFrames: () => deferred.promise },
        { timeoutMs: 20 },
      );
      await vi.advanceTimersByTimeAsync(20);
      const result = await waiting;
      expect(result).toMatchObject({
        status: "timeout",
        complete: false,
        missingFrameIds: [1, 2],
        recording: { truncated: true, gpu: [] },
      });
      deferred.resolve(resolution([gpuIntervalFixture()]));
      await Promise.resolve();
      expect(result.recording.gpu).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["timeout", "cancelled", "unavailable"] as const)(
    "reports %s and partial frames without complete totals",
    async (status) => {
      const partial = {
        ...gpuIntervalFixture(),
        completeness: "incomplete" as const,
        issues: ["readback-timeout" as const],
        metrics: null,
      };
      const result = await finalizeRecording(
        { ...recordingFixture(), gpu: [] },
        {
          resolveFrames: async () => ({ ...resolution([partial]), status }),
        },
      );
      expect(result).toMatchObject({
        status,
        complete: false,
        missingFrameIds: [2],
        incompleteFrameIds: [1],
        recording: { truncated: true },
      });
    },
  );

  it("preserves complete observations when a resolver returns an older incomplete copy", async () => {
    const first = gpuIntervalFixture();
    const partial = {
      ...first,
      completeness: "incomplete" as const,
      issues: ["disabled" as const],
      metrics: null,
    };
    const result = await finalizeRecording(
      { ...recordingFixture(), gpu: [first] },
      { resolveFrames: async () => resolution([partial]) },
    );
    expect(result.incompleteFrameIds).toEqual([]);
    expect(result.recording.gpu[0]).toEqual(first);
  });

  it("keeps the original capture when resolution fails or returns invalid measurements", async () => {
    const recording = recordingFixture();
    const failed = await finalizeRecording(recording, {
      resolveFrames: () => {
        throw new Error("Device unavailable");
      },
    });
    expect(failed).toMatchObject({ status: "error", complete: false, error: "Device unavailable" });
    expect(failed.recording.gpu).toEqual(recording.gpu);
    const invalid = gpuIntervalFixture();
    Reflect.set(invalid.metrics ?? {}, "busyMs", -1);
    const source = { resolveFrames: async () => resolution() };
    Reflect.set(source, "resolveFrames", async () => resolution([invalid]));
    const bad = await finalizeRecording(recording, source);
    expect(bad.status).toBe("error");
    expect(bad.recording.gpu).toEqual(recording.gpu);
  });

  it("rejects invalid timeout options before calling the resolver and handles an empty capture", async () => {
    const source = { resolveFrames: vi.fn(async () => resolution()) };
    await expect(finalizeRecording(recordingFixture(), source, { timeoutMs: -1 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      finalizeRecording(recordingFixture(), source, { timeoutMs: 10_001 }),
    ).rejects.toThrow(RangeError);
    expect(source.resolveFrames).not.toHaveBeenCalled();
    const empty = { ...recordingFixture(), frames: [], gpu: [], counters: [], events: [] };
    const result = await finalizeRecording(empty, source, { timeoutMs: 0 });
    expect(result.complete).toBe(true);
    expect(result.recording.truncated).toBe(false);
  });
});

it("bounds merged pass storage and reports samples omitted at capacity", async () => {
  const base = gpuIntervalFixture();
  const pass = base.passes[0];
  const frame = recordingFixture().frames[0];
  if (!pass || !frame) {
    throw new Error("Missing fixture frame/pass");
  }
  const full = {
    ...base,
    expectedPasses: 256,
    passes: Array.from({ length: 256 }, (_, index) => ({
      ...pass,
      invocation: index + 1,
      startNs: 0,
      endNs: 0,
    })),
    metrics: { renderSumMs: 0, computeSumMs: 0, combinedSumMs: 0, busyMs: 0, elapsedSpanMs: 0 },
  };
  const recording = {
    ...recordingFixture(),
    counters: [],
    events: [],
    frames: Array.from({ length: 65 }, (_, index) => ({
      ...frame,
      id: index + 1,
      startedAtMs: index * 16,
      endedAtMs: (index + 1) * 16,
      scopes: [],
    })),
    gpu: Array.from({ length: 64 }, (_, index) => ({
      ...full,
      frameId: index + 1,
      sequence: index + 1,
    })),
  };
  const result = await finalizeRecording(recording, {
    resolveFrames: async () => resolution([{ ...base, frameId: 65, sequence: 65 }]),
  });
  expect(result).toMatchObject({
    complete: false,
    omittedSamples: 1,
    missingFrameIds: [65],
    recording: { truncated: true },
  });
  expect(result.recording.gpu).toHaveLength(64);
  expect(parseRecording(serializeRecording(result.recording)).ok).toBe(true);
});

it("rejects duplicate/oversized/legacy resolver results and preserves existing legacy observations", async () => {
  const recording = recordingFixture();
  const first = gpuIntervalFixture();
  for (const samples of [
    [first, first],
    Array.from({ length: 6001 }, () => first),
    recording.gpu,
  ]) {
    const source = { resolveFrames: async () => resolution() };
    Reflect.set(source, "resolveFrames", async () => ({ ...resolution(), samples }));
    expect((await finalizeRecording(recording, source)).status).toBe("error");
  }
  const duplicated = { ...recording, gpu: [...recording.gpu, ...recording.gpu] };
  const result = await finalizeRecording(duplicated, { resolveFrames: async () => resolution() });
  expect(result.recording.gpu).toEqual(duplicated.gpu);
});
