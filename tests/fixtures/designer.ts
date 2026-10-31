import { createProfiler, type Recording } from "../../packages/jank/src/index.ts";
import { comparisonReportFixture } from "./comparison-report.ts";
import { gpuIntervalFixture } from "./gpu-sample.ts";
import { viewerReferenceFixture } from "./viewer-reference.ts";

function mockRecording(): Recording {
  const base = viewerReferenceFixture();
  return {
    ...base,
    metadata: {
      ...base.metadata,
      application: { name: "SIMULATED designer review", version: "mock-1" },
    },
    counters: base.frames
      .filter((frame) => frame.id % 5 === 1)
      .map((frame) => ({
        atMs: frame.startedAtMs,
        channelId: "render",
        status: "ready",
        values: {
          drawCalls: 120 + (frame.id % 32),
          triangles: 1280000,
          memoryBytes: 67108864 + frame.id * 1024,
          quality: "SIMULATED high",
          visible: true,
        },
      })),
    gpu: base.frames
      .filter((frame) => frame.id % 4 !== 0)
      .map((frame) => {
        const sample = {
          ...gpuIntervalFixture(),
          frameId: frame.id,
          rendererFrameId: frame.id,
          sequence: frame.id,
        };
        const pass = sample.passes[2];
        if (frame.id !== 243 || !pass) {
          return sample;
        }
        return {
          ...sample,
          passes: sample.passes.slice(0, 2),
          omittedPasses: 1,
          rejectedPasses: [
            {
              ...pass,
              startNs: "18446744000009000000",
              endNs: "18446744000007000000",
              reason: "reversed-timestamp" as const,
            },
          ],
          completeness: "incomplete" as const,
          metrics: null,
          issues: ["reversed-timestamp" as const],
        };
      }),
  };
}

function mockEpisode(): Recording {
  let nowMs = 0;
  const profiler = createProfiler({
    now: () => nowMs,
    application: { name: "SIMULATED sustained transition" },
  });
  profiler.capture.arm({
    thresholdMs: 50,
    sustainedMs: 250,
    beforeFrames: 120,
    afterFrames: 120,
    cooldownMs: 5000,
    timeWindow: { beforeMs: 2000, afterMs: 100, recoveryMs: 100, maxDurationMs: 30000 },
  });
  profiler.beginFrame(0);
  for (const durationMs of [...Array(130).fill(16), ...Array(20).fill(35), ...Array(10).fill(16)]) {
    nowMs += durationMs;
    profiler.beginFrame(nowMs);
  }
  const recording = profiler.capture.completed()[0];
  profiler.dispose();
  if (!recording) {
    throw new Error("Mock episode did not finish");
  }
  const reference = mockRecording();
  return {
    ...recording,
    metadata: {
      ...reference.metadata,
      application: { name: "SIMULATED sustained transition", version: "mock-1" },
    },
  };
}

/** All observations are fabricated for UI review, not device measurements. */
export function designerMockFiles() {
  const comparison = comparisonReportFixture();
  return {
    "mock-recording.json": mockRecording(),
    "mock-episode.json": mockEpisode(),
    "mock-comparison.json": {
      ...comparison,
      trials: comparison.trials.map((trial) => ({
        ...trial,
        context: { ...trial.context, label: `SIMULATED variant ${trial.variant}` },
        recording: {
          ...trial.recording,
          metadata: {
            ...trial.recording.metadata,
            application: { name: "SIMULATED A/B review", version: "mock-1" },
          },
          counters: trial.recording.frames
            .filter((frame) => frame.id % 3 === 1)
            .map((frame) => ({
              atMs: frame.startedAtMs,
              channelId: "physics",
              status: "ready" as const,
              values: {
                bodies: (trial.variant === "A" ? 60 : 90) + (frame.id % 8),
                memoryBytes: 33554432 + frame.id * 4096,
              },
            })),
        },
      })),
    },
  };
}
