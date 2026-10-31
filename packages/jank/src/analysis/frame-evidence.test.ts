import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { frameEvidence, nearbyEvents } from "./frame-evidence.ts";

it("orders nearby events by actual time, retaining duplicates and signed offsets even in frame gaps", () => {
  const base = recordingFixture();
  const recording = {
    ...base,
    events: [
      { atMs: 122, label: "After", detail: null },
      { atMs: 110, label: "Before", detail: "Detail" },
      { atMs: 110, label: "Before", detail: null },
      { atMs: 9000, label: "Far", detail: null },
    ],
  };
  expect(nearbyEvents(recording, 18).map((event) => [event.index, event.offsetMs])).toEqual([
    [1, -8],
    [2, -8],
    [0, 4],
  ]);
});
it("copies selected frame evidence, raw correlated GPU observations and aged counters without inventing unknown values", () => {
  const recording = recordingFixture();
  const evidence = frameEvidence(recording, 2);
  expect(evidence?.frame).toEqual(recording.frames[1]);
  expect(evidence?.counters[0]?.observation).toMatchObject({ value: 3, ageMs: 6 });
  expect(evidence?.gpu).toEqual([]);
  expect(frameEvidence(recording, 1)?.gpu).toEqual(recording.gpu);
  expect(evidence?.budgetMs).toBe(1000 / recording.targetFps);
  expect(frameEvidence(recording, null)).toBeNull();
  expect(frameEvidence(recording, 900)).toBeNull();
});

it("retains every GPU observation and exact rejected timestamps in copied evidence", () => {
  const sample = {
    ...gpuIntervalFixture(),
    completeness: "incomplete" as const,
    metrics: null,
    issues: ["reversed-timestamp" as const],
    rejectedPasses: [
      {
        id: "cloud",
        label: "Cloud",
        type: "compute" as const,
        category: null,
        invocation: 4,
        rendererFrameId: 8,
        reason: "reversed-timestamp" as const,
        startNs: "18446744073709551615",
        endNs: "18446744073709551614",
      },
    ],
  };
  const recording = { ...recordingFixture(), gpu: [sample, { ...sample, sequence: 2 }] };
  const copied = JSON.parse(JSON.stringify(frameEvidence(recording, 1)));
  expect(copied.gpu).toEqual(recording.gpu);
  expect(copied.gpu[0].metrics).toBeNull();
  expect(copied.recordingCoverage.gpu.incompleteFrames).toBe(1);
});
