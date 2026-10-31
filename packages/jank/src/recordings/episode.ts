import type { FrameSample } from "../core/frames.ts";
import { recordingLimits } from "./limits.ts";

export interface CaptureTimeWindow {
  readonly beforeMs: number;
  readonly afterMs: number;
  readonly recoveryMs: number;
  /** Maximum elapsed time after the first trigger ends; sealed frames may cross the boundary. */
  readonly maxDurationMs: number;
}
export type EpisodeStopReason =
  | "recovered"
  | "disarmed"
  | "frame-capacity"
  | "duration-limit"
  | "manual-start";
export interface EpisodeMetadata {
  readonly timeWindow: CaptureTimeWindow;
  readonly cooldownMs: number;
  readonly triggerFrameIds: readonly number[];
  readonly stopReason: EpisodeStopReason;
}
export interface EpisodeCollection {
  readonly timeWindow: CaptureTimeWindow;
  readonly triggerEndedAtMs: number;
  readonly triggerFrameIds: number[];
  deadlineMs: number;
  stopReason: EpisodeStopReason | null;
}
export function validateTimeWindow(window: CaptureTimeWindow): void {
  if (
    Object.values(window).some((value) => !Number.isFinite(value) || value < 0 || value > 600000) ||
    !Number.isFinite(window.beforeMs) ||
    !Number.isFinite(window.afterMs) ||
    !Number.isFinite(window.recoveryMs) ||
    !(window.maxDurationMs > 0) ||
    window.maxDurationMs < Math.max(window.afterMs, window.recoveryMs)
  ) {
    throw new RangeError(
      "Episode windows must be finite, 0–600000 ms; duration limit must be positive and cover after/recovery windows",
    );
  }
}
export function beginEpisode(window: CaptureTimeWindow, frame: FrameSample): EpisodeCollection {
  return {
    timeWindow: { ...window },
    triggerEndedAtMs: frame.endedAtMs,
    triggerFrameIds: [frame.id],
    deadlineMs: frame.endedAtMs + Math.max(window.afterMs, window.recoveryMs),
    stopReason: window.afterMs === 0 && window.recoveryMs === 0 ? "recovered" : null,
  };
}
export function advanceEpisode(
  episode: EpisodeCollection,
  frame: FrameSample,
  context: { thresholdMs: number; extend: boolean; frameCount: number },
): void {
  if (frame.endedAtMs - frame.startedAtMs > context.thresholdMs) {
    episode.triggerFrameIds.push(frame.id);
    if (context.extend) {
      episode.deadlineMs = Math.max(
        episode.deadlineMs,
        frame.endedAtMs + episode.timeWindow.recoveryMs,
      );
    }
  }
  const hardEnd = episode.triggerEndedAtMs + episode.timeWindow.maxDurationMs;
  if (frame.endedAtMs >= episode.deadlineMs && episode.deadlineMs <= hardEnd) {
    episode.stopReason = context.extend ? "recovered" : "disarmed";
  } else if (context.frameCount >= recordingLimits.frames) {
    episode.stopReason = "frame-capacity";
  } else if (frame.endedAtMs >= hardEnd) {
    episode.stopReason = "duration-limit";
  }
}
/** Includes the whole frame straddling a boundary; gaps do not count as retained context. */
export function coversTimeWindow(
  frames: readonly FrameSample[],
  fromMs: number,
  toMs: number,
): boolean {
  let coveredUntil = fromMs;
  for (const frame of frames) {
    if (frame.endedAtMs <= coveredUntil) {
      continue;
    }
    if (frame.startedAtMs > coveredUntil) {
      return false;
    }
    coveredUntil = frame.endedAtMs;
    if (coveredUntil >= toMs) {
      return true;
    }
  }
  return fromMs === toMs;
}
export function episodeProgress(episode: EpisodeCollection, endedAtMs: number) {
  return {
    triggerCount: episode.triggerFrameIds.length,
    remainingMs: episode.stopReason
      ? 0
      : Math.max(
          0,
          Math.min(
            episode.deadlineMs,
            episode.triggerEndedAtMs + episode.timeWindow.maxDurationMs,
          ) - endedAtMs,
        ),
  };
}
