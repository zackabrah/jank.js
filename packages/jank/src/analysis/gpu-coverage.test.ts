import { expect, it } from "vitest";
import { gpuIntervalFixture } from "../../../../tests/fixtures/gpu-sample.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { summarizeGpuCoverage } from "./gpu-coverage.ts";

it("counts frame coverage once, separates known losses, and leaves absent evidence unexplained", () => {
  const sample = gpuIntervalFixture();
  const source = recordingFixture();
  const first = source.frames[0];
  if (!first) {
    throw new Error("Missing fixture frame");
  }
  const frames = Array.from({ length: 5 }, (_, index) => ({ ...first, id: index + 1 }));
  const gpu = [
    sample,
    { ...sample, sequence: 2 },
    {
      ...sample,
      sequence: 3,
      frameId: 2,
      completeness: "incomplete" as const,
      metrics: null,
      issues: ["retention-capacity" as const],
      passes: [],
      omittedPasses: 3,
    },
    {
      ...sample,
      sequence: 4,
      frameId: 3,
      completeness: "incomplete" as const,
      metrics: null,
      issues: ["sampled-out" as const],
      passes: [],
      omittedPasses: 3,
    },
    {
      ...sample,
      sequence: 5,
      frameId: 4,
      completeness: "incomplete" as const,
      metrics: null,
      issues: ["zero-timestamp" as const, "readback-error" as const],
    },
    { ...sample, sequence: 6, frameId: null },
  ];
  expect(summarizeGpuCoverage({ frames, gpu })).toEqual({
    totalFrames: 5,
    completeFrames: 1,
    incompleteFrames: 2,
    sampledFrames: 1,
    missingFrames: 1,
    coveragePercent: 20,
    reasons: [
      { reason: "retention-capacity", frames: 1 },
      { reason: "sampled-out", frames: 1 },
      { reason: "zero-timestamp", frames: 1 },
      { reason: "readback-error", frames: 1 },
    ],
  });
  expect(summarizeGpuCoverage({ frames: [], gpu: [] }).coveragePercent).toBeNull();
  expect(summarizeGpuCoverage(source).missingFrames).toBe(2);
});

it("does not mark a frame complete when another associated bracket is incomplete", () => {
  const source = recordingFixture();
  const sample = gpuIntervalFixture();
  expect(
    summarizeGpuCoverage({
      ...source,
      gpu: [
        sample,
        {
          ...sample,
          sequence: 2,
          completeness: "incomplete",
          metrics: null,
          issues: ["query-capacity"],
        },
      ],
    }),
  ).toMatchObject({ completeFrames: 0, incompleteFrames: 1, missingFrames: 1 });
});
