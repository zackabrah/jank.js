import { gpuFrameCoverage, gpuSpan } from "../gpu/model.ts";
import { unionDuration } from "./timing.ts";
import type { DiagnosticFrame, PerformanceRecording } from "./types.ts";

/** Keeps vsync jitter around a frame time from counting as slow frames. */
export const frameToleranceMs = (budgetMs: number) => Math.max(1, budgetMs * 0.05);

/** From one 57 Hz machine and unit tests; not yet checked against scenes close to their limit. */
const PACED_WORK_SHARE = 0.8;

export const frameCpuMs = (frame: DiagnosticFrame) =>
  frame.scopes.length ? unionDuration(frame.scopes) : frame.update + frame.render;

export function medianOf(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * The one display-pacing rule, for the panel, viewer, comparison and analyzer. The display set the
 * frame time when the busier of CPU and GPU (they run in parallel, so not their sum) leaves plenty
 * of both the frame and the budget unused. `workMs` is null without GPU timing, because a
 * GPU-limited scene would look just the same, so no claim is made.
 */
export function displayPace(budgetMs: number, typicalMs: number, workMs: number | null) {
  if (workMs === null || !(workMs < Math.min(typicalMs, budgetMs) * PACED_WORK_SHARE)) return null;
  const paceMs = Math.max(typicalMs, budgetMs);
  return { typicalMs, limitMs: paceMs + frameToleranceMs(paceMs) };
}

export function recordingDisplayPace(
  recording: PerformanceRecording,
  budgetMs = recording.budget.frameMs,
) {
  const spans = (recording.gpuTiming?.frames ?? []).flatMap((frame) =>
    gpuFrameCoverage(frame).completeness === "complete" ? (gpuSpan(frame) ?? []) : [],
  );
  if (!recording.frames.length || !spans.length) return null;
  return displayPace(
    budgetMs,
    medianOf(recording.frames.map((frame) => frame.interval)),
    Math.max(medianOf(recording.frames.map(frameCpuMs)), medianOf(spans)),
  );
}
