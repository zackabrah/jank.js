import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { ObservationHistory } from "./observations.ts";

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
