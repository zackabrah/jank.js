import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { summarizeGpuEvidence } from "./gpu-evidence.ts";

it("distinguishes sampled frames, useful partial intervals and complete totals", () => {
  const source = recordingFixture();
  const sample = gpuIntervalFixture();
  const partial = {
    ...sample,
    completeness: "incomplete" as const,
    metrics: null,
    issues: ["reversed-timestamp" as const],
    passes: sample.passes.slice(0, 2),
    omittedPasses: 1,
    rejectedPasses: [
      {
        ...sample.passes[2],
        id: "fft",
        label: "Ocean FFT",
        type: "compute" as const,
        category: "water",
        invocation: 3,
        rendererFrameId: 8,
        startNs: "9",
        endNs: "7",
        reason: "reversed-timestamp" as const,
      },
    ],
  };
  expect(
    summarizeGpuEvidence({
      ...source,
      gpu: [
        partial,
        {
          ...sample,
          frameId: 2,
          passes: [],
          expectedPasses: 0,
          metrics: null,
          completeness: "incomplete",
          issues: ["sampled-out"],
        },
        { ...sample, frameId: null },
      ],
    }),
  ).toEqual({
    totalFrames: 2,
    intervalFrames: 2,
    sampledFrames: 1,
    validFrames: 1,
    completeFrames: 0,
    validPairs: 2,
    rejectedPairs: 1,
    omittedPasses: 1,
    sampledOutFrames: 1,
    missingFrames: 0,
  });
});

it("counts frame identities once, excludes unlinked evidence and keeps missing timing unknown", () => {
  const source = recordingFixture();
  const sample = gpuIntervalFixture();
  expect(
    summarizeGpuEvidence({
      ...source,
      gpu: [sample, { ...sample, sequence: 2 }, { ...sample, frameId: 900 }],
    }),
  ).toMatchObject({
    sampledFrames: 1,
    validFrames: 1,
    completeFrames: 1,
    validPairs: 6,
    missingFrames: 1,
  });
  expect(summarizeGpuEvidence(source)).toMatchObject({
    intervalFrames: 0,
    sampledFrames: 1,
    validFrames: 1,
    completeFrames: 1,
    validPairs: 0,
    missingFrames: 1,
  });
  expect(
    summarizeGpuEvidence({
      ...source,
      gpu: [
        {
          ...sample,
          passes: [],
          completeness: "incomplete",
          metrics: null,
          issues: ["readback-error"],
          omittedPasses: 3,
        },
      ],
    }),
  ).toMatchObject({ sampledFrames: 0, validFrames: 0, completeFrames: 0, omittedPasses: 3 });
  expect(summarizeGpuEvidence({ frames: [], gpu: [] })).toMatchObject({
    totalFrames: 0,
    missingFrames: 0,
  });
});
