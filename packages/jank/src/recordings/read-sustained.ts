import type { FrameSample } from "../core/frames.ts";
import { integer, invalid, number, object } from "./read-values.ts";
import type { SustainedTrigger } from "./sustained-trigger.ts";

export function readSustained(
  value: unknown,
  frames: readonly FrameSample[],
  context: { trigger: FrameSample; thresholdMs: number; truncated: boolean },
): SustainedTrigger {
  const path = "$.capture.sustained";
  const data = object(value, path);
  const result = {
    durationMs: number(data.durationMs, `${path}.durationMs`, Number.MIN_VALUE, 600000),
    startedAtMs: number(data.startedAtMs, `${path}.startedAtMs`),
    firstFrameId: integer(data.firstFrameId, `${path}.firstFrameId`, 1, context.trigger.id),
    frameCount: integer(data.frameCount, `${path}.frameCount`, 1, context.trigger.id),
  };
  const retained = frames.filter(
    (frame) => frame.id >= result.firstFrameId && frame.id <= context.trigger.id,
  );
  const first = retained[0];
  const elapsedMs = context.trigger.endedAtMs - result.startedAtMs;
  if (
    !first ||
    elapsedMs < result.durationMs ||
    context.trigger.startedAtMs - result.startedAtMs >= result.durationMs
  ) {
    invalid(path, "Sustained trigger must confirm the first elapsed-duration crossing");
  }
  const missingPrefix = first.id !== result.firstFrameId;
  const validPrefix = missingPrefix
    ? context.truncated &&
      result.startedAtMs < first.startedAtMs &&
      result.frameCount > retained.length
    : result.startedAtMs === first.startedAtMs && result.frameCount === retained.length;
  if (!validPrefix || result.frameCount > context.trigger.id - result.firstFrameId + 1) {
    invalid(path, "Sustained onset/count does not match retained context or truncation");
  }
  let previousEnd = first.startedAtMs;
  for (const frame of retained) {
    if (
      frame.startedAtMs !== previousEnd ||
      frame.endedAtMs - frame.startedAtMs <= context.thresholdMs
    ) {
      invalid(path, "Sustained evidence must remain contiguous and over budget");
    }
    previousEnd = frame.endedAtMs;
  }
  return result;
}
