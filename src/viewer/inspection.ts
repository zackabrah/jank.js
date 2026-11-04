import { gpuFrameCoverage } from "../gpu/model.ts";
import { summarizeRecording } from "../recording/summary.ts";
import type { PerformanceRecording } from "../recording/types.ts";

export function inspectRecording(recording: PerformanceRecording) {
  const summary = summarizeRecording(recording);
  const { frames, capture } = recording;
  const spikeThreshold = recording.budget.frameMs * 2;
  const slowFrames = frames.flatMap((frame, index) =>
    frame.interval > spikeThreshold ? [{ frame, index }] : [],
  );
  const slowIndices = slowFrames.map(({ index }) => index);
  const spikes = slowFrames
    .sort((a, b) => b.frame.interval - a.frame.interval || a.index - b.index)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const indices = new Map(frames.map((frame, index) => [frame.id, index]));
  const gpuProblems = (recording.gpuTiming?.frames ?? [])
    .flatMap((record) => {
      const coverage = gpuFrameCoverage(record);
      const index = indices.get(record.frameId);
      return index === undefined || coverage.completeness === "complete"
        ? []
        : [{ index, record, coverage }];
    })
    .sort((a, b) => a.index - b.index);
  const trigger = capture.triggerFrame;
  const context = capture.context;
  const end = context?.endFrame ?? trigger;
  const window =
    capture.mode === "automatic" && frames.length
      ? {
          before: trigger === null ? null : frames.filter((frame) => frame.id < trigger).length,
          after: end === null ? null : frames.filter((frame) => frame.id > end).length,
          requestedBefore: capture.beforeFrames,
          requestedAfter: capture.afterFrames,
          phases: context
            ? [
                {
                  label: "Before onset",
                  count: frames.filter((frame) => frame.id < context.onsetFrame).length,
                },
                {
                  label: "Qualifying",
                  count: frames.filter(
                    (frame) =>
                      frame.id >= context.onsetFrame && frame.id < (trigger ?? context.onsetFrame),
                  ).length,
                },
                {
                  label: context.rule.keep === "episode" ? "Episode" : "Trigger",
                  count: frames.filter(
                    (frame) =>
                      frame.id >= (trigger ?? context.onsetFrame) && frame.id <= context.endFrame,
                  ).length,
                },
                {
                  label: "After",
                  count: frames.filter((frame) => frame.id > context.endFrame).length,
                },
              ].filter((phase) => phase.count > 0)
            : [],
        }
      : null;
  return { ...summary, spikeThreshold, slowIndices, spikes, gpuProblems, window };
}

export type RecordingInspection = ReturnType<typeof inspectRecording>;
