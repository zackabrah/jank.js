import { serializeRecording } from "../recordings/codec.ts";
import type { Recording } from "../recordings/recording.ts";
import type { ComparisonContext, ComparisonOptions, ComparisonReport } from "./comparison.ts";

export const comparisonByteLimit = 32 * 1024 * 1024;
export function validateComparisonOptions(options: ComparisonOptions): void {
  if (
    !Number.isInteger(options.pairs) ||
    options.pairs < 2 ||
    options.pairs > 6 ||
    !Number.isFinite(options.warmupMs) ||
    options.warmupMs < 500 ||
    options.warmupMs > 10000 ||
    !Number.isFinite(options.measureMs) ||
    options.measureMs < 1000 ||
    options.measureMs > 10000
  ) {
    throw new RangeError("Use 2–6 pairs, 0.5–10 s warm-up and 1–10 s measurement.");
  }
}
function validText(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}
export function copyComparisonContext(context: ComparisonContext): ComparisonContext {
  const resolution = context.resolution;
  if (
    !validText(context.label) ||
    !validText(context.animation) ||
    context.settings.length > 32 ||
    context.settings.some((setting) => !validText(setting.label) || !validSetting(setting.value)) ||
    (resolution !== null &&
      (!Number.isSafeInteger(resolution.widthPx) ||
        resolution.widthPx <= 0 ||
        !Number.isSafeInteger(resolution.heightPx) ||
        resolution.heightPx <= 0))
  ) {
    throw new RangeError(
      "Comparison context needs bounded labels, finite settings and a positive resolution or null.",
    );
  }
  return {
    ...context,
    settings: context.settings.map((setting) => ({ ...setting })),
    resolution: resolution && { ...resolution },
  };
}
function validSetting(value: string | number | boolean): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "boolean" || validText(value);
}
/** Drain frames and the boundary-crossing frame stay out of the measured recording. */
export function selectComparisonWindow(
  recording: Recording,
  firstFrameId: number,
  measureMs: number,
): Recording {
  const first = recording.frames.find((frame) => frame.id >= firstFrameId);
  const cutoffMs = (first?.startedAtMs ?? 0) + measureMs;
  const frames = recording.frames.filter(
    (frame) => frame.id >= firstFrameId && frame.endedAtMs <= cutoffMs,
  );
  const ids = new Set(frames.map((frame) => frame.id));
  const from = frames[0]?.startedAtMs ?? 0;
  const to = frames.at(-1)?.endedAtMs ?? 0;
  return {
    ...recording,
    frames,
    gpu: recording.gpu.filter((sample) => sample.frameId !== null && ids.has(sample.frameId)),
    counters: recording.counters.filter((sample) => sample.atMs >= from && sample.atMs <= to),
    events: recording.events.filter((sample) => sample.atMs >= from && sample.atMs <= to),
  };
}
/** A portable bundle; each nested recording remains a normal validated Jank recording. */
export function serializeComparison(report: ComparisonReport): string {
  for (const trial of report.trials) {
    serializeRecording(trial.recording);
    copyComparisonContext(trial.context);
  }
  const json = JSON.stringify(report);
  if (new TextEncoder().encode(json).byteLength > comparisonByteLimit) {
    throw new RangeError("Comparison exceeds the 32 MiB export limit.");
  }
  return json;
}
