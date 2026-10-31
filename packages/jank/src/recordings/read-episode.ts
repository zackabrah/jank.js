import type { FrameSample } from "../core/frames.ts";
import { type EpisodeMetadata, validateTimeWindow } from "./episode.ts";
import { recordingLimits } from "./limits.ts";
import { choice, integer, invalid, list, number, object } from "./read-values.ts";

export function readEpisode(
  value: unknown,
  frames: readonly FrameSample[],
  triggerFrameId: number,
  thresholdMs: number,
): EpisodeMetadata {
  const path = "$.capture.episode";
  const data = object(value, path);
  const window = object(data.timeWindow, `${path}.timeWindow`);
  const timeWindow = {
    beforeMs: number(window.beforeMs, `${path}.timeWindow.beforeMs`, 0, 600000),
    afterMs: number(window.afterMs, `${path}.timeWindow.afterMs`, 0, 600000),
    recoveryMs: number(window.recoveryMs, `${path}.timeWindow.recoveryMs`, 0, 600000),
    maxDurationMs: number(
      window.maxDurationMs,
      `${path}.timeWindow.maxDurationMs`,
      Number.MIN_VALUE,
      600000,
    ),
  };
  try {
    validateTimeWindow(timeWindow);
  } catch {
    invalid(`${path}.timeWindow`, "Duration limit must cover after/recovery windows");
  }
  const triggerFrameIds = list(
    data.triggerFrameIds,
    `${path}.triggerFrameIds`,
    recordingLimits.frames,
    (value, path) => integer(value, path, 1),
  );
  const expected = frames
    .filter(
      (frame) => frame.id >= triggerFrameId && frame.endedAtMs - frame.startedAtMs > thresholdMs,
    )
    .map((frame) => frame.id);
  if (
    !triggerFrameIds.length ||
    triggerFrameIds.length !== expected.length ||
    triggerFrameIds.some((id, index) => id !== expected[index])
  ) {
    invalid(
      `${path}.triggerFrameIds`,
      "Expected every retained threshold crossing in frame order, starting with the original trigger",
    );
  }
  const stopReason = choice(data.stopReason, `${path}.stopReason`, [
    "recovered",
    "disarmed",
    "frame-capacity",
    "duration-limit",
    "manual-start",
  ]);
  return {
    timeWindow,
    triggerFrameIds,
    stopReason,
    cooldownMs: number(data.cooldownMs, `${path}.cooldownMs`),
  };
}
export function validateEpisodeEnd(
  episode: EpisodeMetadata,
  frames: readonly FrameSample[],
  trigger: FrameSample,
  truncated: boolean,
): void {
  const last = frames.at(-1);
  const lastSlow = frames.find((frame) => frame.id === episode.triggerFrameIds.at(-1));
  if (!last || !lastSlow) {
    invalid("$.capture.episode", "Missing episode boundary");
  }
  const elapsedMs = last.endedAtMs - trigger.endedAtMs;
  if (
    (episode.stopReason === "frame-capacity" && frames.length !== recordingLimits.frames) ||
    (episode.stopReason === "duration-limit" && elapsedMs < episode.timeWindow.maxDurationMs) ||
    (episode.stopReason === "recovered" &&
      (elapsedMs < episode.timeWindow.afterMs ||
        last.endedAtMs - lastSlow.endedAtMs < episode.timeWindow.recoveryMs)) ||
    (episode.stopReason === "disarmed" && elapsedMs < episode.timeWindow.afterMs)
  ) {
    invalid("$.capture.episode.stopReason", "Episode ending does not match retained boundaries");
  }
  if (
    ["frame-capacity", "duration-limit", "manual-start"].includes(episode.stopReason) &&
    !truncated
  ) {
    invalid("$.truncated", "A bounded or interrupted episode must report truncation");
  }
}
