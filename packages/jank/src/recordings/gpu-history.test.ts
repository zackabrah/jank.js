import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { parseRecording, serializeRecording } from "./codec.ts";
import { ObservationHistory } from "./observations.ts";

it("keeps a reason-bearing frame marker when pass retention capacity is exhausted", () => {
  const history = new ObservationHistory();
  for (let sequence = 1; sequence <= 5500; sequence += 1) {
    history.observeGpu(
      {
        status: "ready",
        currentRendererFrameId: 8,
        droppedSamples: 0,
        sample: { ...gpuIntervalFixture(), sequence, frameId: sequence },
      },
      120,
      () => true,
    );
  }
  const selection = history.select(recordingFixture().frames);
  expect(selection.gpu).toHaveLength(2);
  expect(selection.gpu[0]).toMatchObject({
    frameId: 1,
    passes: [],
    completeness: "incomplete",
    metrics: null,
    omittedPasses: 3,
    issues: ["retention-capacity"],
  });
  expect(history.capacity()).toEqual({ remainingSamples: 500, remainingPasses: 1 });
  const recording = { ...recordingFixture(), ...selection };
  expect(parseRecording(serializeRecording(recording))).toEqual({ ok: true, recording });
  expect(history.coverage(recording.frames)).toMatchObject({
    incompleteFrames: 2,
    reasons: [{ reason: "retention-capacity", frames: 2 }],
  });
  history.clear();
  expect(history.capacity()).toEqual({ remainingSamples: 6000, remainingPasses: 16384 });
});

it("accounts for rejected diagnostics and stays bounded when zero-detail samples fill the pool", () => {
  const history = new ObservationHistory();
  const sample = gpuIntervalFixture();
  const rejected = {
    ...sample,
    passes: [],
    completeness: "incomplete" as const,
    metrics: null,
    issues: ["reversed-timestamp" as const],
    omittedPasses: 3,
    rejectedPasses: sample.passes.map((pass) => ({
      ...pass,
      reason: "reversed-timestamp" as const,
      startNs: "12",
      endNs: "11",
    })),
  };
  history.observeGpu(
    { status: "ready", currentRendererFrameId: 8, droppedSamples: 0, sample: rejected },
    120,
    () => true,
  );
  expect(history.capacity().remainingPasses).toBe(16381);
  for (let sequence = 1; sequence <= 6001; sequence += 1) {
    history.observeGpu(
      {
        status: "ready",
        currentRendererFrameId: 8,
        droppedSamples: 0,
        sample: {
          ...sample,
          sequence,
          frameId: sequence,
          expectedPasses: 0,
          passes: [],
          metrics: {
            renderSumMs: 0,
            computeSumMs: 0,
            combinedSumMs: 0,
            busyMs: 0,
            elapsedSpanMs: 0,
          },
        },
      },
      120,
      () => true,
    );
  }
  expect(history.capacity()).toEqual({ remainingSamples: 0, remainingPasses: 16384 });
  expect(history.select(recordingFixture().frames).gpu.map((sample) => sample.frameId)).toEqual([
    2,
  ]);
});

it("keeps the latest interval sequence across pending and error states", () => {
  const history = new ObservationHistory();
  const sample = gpuIntervalFixture();
  history.observeGpu(
    {
      status: "ready",
      currentRendererFrameId: 8,
      droppedSamples: 0,
      sample: { ...sample, sequence: 3 },
    },
    120,
    () => true,
  );
  history.observeGpu({ status: "error", message: "Read failed" }, 120, () => true);
  history.observeGpu(
    { status: "ready", currentRendererFrameId: 8, droppedSamples: 0, sample },
    120,
    () => true,
  );
  expect(history.snapshot().gpu).toEqual({ status: "error", message: "Read failed" });
});

it("retains out-of-order GPU frames once without moving the live sample backwards", () => {
  const history = new ObservationHistory();
  const sample = gpuIntervalFixture();
  for (const sequence of [2, 1, 2, 1]) {
    history.observeGpu(
      {
        status: "ready",
        currentRendererFrameId: 8,
        currentFrameSequence: 3,
        pendingFrames: 1,
        droppedSamples: 0,
        sample: { ...sample, frameId: sequence, sequence },
      },
      120,
      () => true,
    );
  }
  expect(history.snapshot().gpu).toMatchObject({
    currentFrameSequence: 3,
    pendingFrames: 1,
    sample: { frameId: 2 },
  });
  const selected = history.select(recordingFixture().frames);
  expect(selected.gpu).toHaveLength(2);
  const copy = history.snapshot().gpu;
  if (copy?.status === "ready" && copy.sample.measurement === "intervals") {
    Reflect.set(copy.sample.clock, "originNs", "0");
    Reflect.set(copy.sample.metrics ?? {}, "busyMs", 999);
  }
  expect(history.snapshot().gpu).toMatchObject({
    sample: { clock: sample.clock, metrics: sample.metrics },
  });
  history.observeGpu(
    {
      status: "ready",
      currentRendererFrameId: 8,
      droppedSamples: 0,
      sample: {
        ...sample,
        sequence: 3,
        completeness: "incomplete",
        metrics: null,
        expectedPasses: 4,
        omittedPasses: 1,
        issues: ["query-capacity"],
      },
    },
    120,
    () => true,
  );
  const partial = history.snapshot().gpu;
  if (partial?.status === "ready" && partial.sample.measurement === "intervals") {
    Reflect.set(partial.sample.issues, "0", "disposed");
  }
  expect(history.snapshot().gpu).toMatchObject({
    sample: { metrics: null, issues: ["query-capacity"] },
  });
});

it("bounds retained GPU intervals independently of frame count and marks omissions", () => {
  const history = new ObservationHistory();
  for (let sequence = 1; sequence <= 5500; sequence += 1) {
    history.observeGpu(
      {
        status: "ready",
        currentRendererFrameId: 8,
        droppedSamples: 0,
        sample: { ...gpuIntervalFixture(), sequence, frameId: null },
      },
      120,
      () => true,
    );
  }
  const selected = history.select(recordingFixture().frames);
  expect(
    selected.gpu.reduce((count, sample) => count + sample.passes.length, 0),
  ).toBeLessThanOrEqual(16_384);
  expect(selected.truncated).toBe(true);
  history.clear();
  expect(history.snapshot().gpu).toBeNull();
});
