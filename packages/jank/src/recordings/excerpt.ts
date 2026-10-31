import { copyRecording } from "./copy.ts";
import type { Recording } from "./recording.ts";

export const captureContextFrames = 120;

/** Offline detected spikes use a 120-frame context on each side; live triggers keep their saved window. */
export function extractCapture(recording: Recording, frameId: number): Recording {
  if (recording.capture.kind === "automatic") {
    if (frameId !== recording.capture.triggerFrameId) {
      throw new RangeError("Choose the recorded automatic trigger");
    }
    return copyRecording(recording);
  }
  const index = recording.frames.findIndex((frame) => frame.id === frameId);
  const trigger = recording.frames[index];
  if (!trigger || trigger.endedAtMs - trigger.startedAtMs <= 2000 / recording.targetFps) {
    throw new RangeError("Choose a detected frame exceeding two budgets");
  }
  const start = Math.max(0, index - captureContextFrames);
  const end = Math.min(recording.frames.length, index + captureContextFrames + 1);
  const frames = recording.frames.slice(start, end);
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) {
    throw new Error("A capture must retain its trigger");
  }
  const entireRecording = start === 0 && end === recording.frames.length;
  const ids = new Set(frames.map((frame) => frame.id));
  const gpu = recording.gpu.filter((sample) =>
    sample.frameId === null ? entireRecording : ids.has(sample.frameId),
  );
  const omittedUnlinked =
    !entireRecording && recording.gpu.some((sample) => sample.frameId === null);
  const inWindow = (sample: { atMs: number }) =>
    sample.atMs >= first.startedAtMs && sample.atMs <= last.endedAtMs;
  return copyRecording({
    ...recording,
    capture: { kind: "manual" },
    frames,
    gpu,
    events: recording.events.filter(inWindow),
    counters: recording.counters.filter(inWindow),
    truncated:
      recording.truncated ||
      index < captureContextFrames ||
      index + captureContextFrames >= recording.frames.length ||
      omittedUnlinked,
  });
}
