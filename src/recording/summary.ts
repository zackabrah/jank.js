import { gpuCoverage, gpuInventoryUnknown } from "../gpu/model.ts";
import { recordingDisplayPace } from "./display-pace.ts";
import type { PerformanceRecording } from "./types.ts";

/** The one over-budget rule for a recording: the display's pace, or the budget plus two timer ticks. */
export const frameOverLimit = (
  recording: PerformanceRecording,
  pace = recordingDisplayPace(recording),
) =>
  pace?.limitMs ??
  recording.budget.frameMs +
    (recording.metadata.environment.cpuTimer.estimatedResolutionMs ?? 0) * 2;

export function summarizeRecording(recording: PerformanceRecording) {
  const { frames } = recording;
  let worstIndex = 0;
  frames.forEach((frame, index) => {
    if (frame.interval > (frames[worstIndex]?.interval ?? 0)) worstIndex = index;
  });
  const triggerIndex = frames.findIndex((frame) => frame.id === recording.capture.triggerFrame);
  const intervals = frames.map((frame) => frame.interval).sort((a, b) => a - b);
  const pace = recordingDisplayPace(recording);
  const overLimit = frameOverLimit(recording, pace);
  const gpu = gpuCoverage(
    frames.map((frame) => frame.id),
    recording.gpuTiming?.frames ?? [],
  );
  if (!recording.gpuTiming && recording.gpu) {
    gpu.unknown = gpu.missing;
    gpu.missing = 0;
  }
  return {
    gpu,
    gpuLabel: recording.gpuTiming
      ? gpuInventoryUnknown(gpu)
        ? "unknown"
        : `${gpu.complete}/${gpu.total} complete`
      : recording.gpu
        ? "unknown"
        : "not recorded",
    durationMs: frames.length
      ? (frames.at(-1)?.at ?? 0) - (frames[0]?.at ?? 0) + (frames[0]?.interval ?? 0)
      : 0,
    worst: frames[worstIndex] ?? null,
    worstIndex,
    triggerIndex,
    initialIndex: triggerIndex < 0 ? worstIndex : triggerIndex,
    p95: intervals[Math.ceil(intervals.length * 0.95) - 1] ?? null,
    overLimit,
    displayPacedMs: pace?.typicalMs ?? null,
    overCount: frames.filter((frame) => frame.interval > overLimit).length,
    complete: frames.filter((frame) => frame.coverage === "complete").length,
  };
}
