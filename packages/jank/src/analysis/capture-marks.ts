import type { Recording } from "../recordings/recording.ts";

export interface CaptureMark {
  readonly rank: number;
  readonly frameId: number;
  readonly frameIndex: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly source: "recorded" | "detected";
  readonly nearbyEvents: string;
}

/** Automatic files retain their actual trigger. Other files expose up to 50 detected spikes. */
export function findCaptureMarks(recording: Recording | null): CaptureMark[] {
  const originMs = recording?.frames[0]?.startedAtMs;
  if (!recording || originMs === undefined) {
    return [];
  }
  const automatic = recording.capture.kind === "automatic" ? recording.capture : null;
  const peaks = capturePeaks(recording);
  return peaks
    .sort((a, b) => b.durationMs - a.durationMs || a.frameIndex - b.frameIndex)
    .slice(0, 50)
    .map((peak, index) => {
      const frame = recording.frames[peak.frameIndex];
      if (!frame) {
        throw new Error("Capture peak must reference a recorded frame");
      }
      return {
        rank: index + 1,
        frameId: frame.id,
        frameIndex: peak.frameIndex,
        elapsedMs: frame.startedAtMs - originMs,
        durationMs: peak.durationMs,
        source: automatic ? "recorded" : "detected",
        nearbyEvents: nearbyEvents(recording, peak.frameIndex),
      };
    });
}
function capturePeaks(recording: Recording): { frameIndex: number; durationMs: number }[] {
  const automatic = recording.capture.kind === "automatic" ? recording.capture : null;
  const thresholdMs = automatic?.thresholdMs ?? 2000 / recording.targetFps;
  const peaks: { frameIndex: number; durationMs: number }[] = [];
  for (const [frameIndex, frame] of recording.frames.entries()) {
    const durationMs = frame.endedAtMs - frame.startedAtMs;
    if (automatic ? frame.id !== automatic.triggerFrameId : durationMs <= thresholdMs) {
      continue;
    }
    const previous = peaks.at(-1);
    if (!automatic && previous && frameIndex - previous.frameIndex <= 10) {
      if (durationMs > previous.durationMs) {
        peaks[peaks.length - 1] = { frameIndex, durationMs };
      }
    } else {
      peaks.push({ frameIndex, durationMs });
    }
  }
  return peaks;
}
function nearbyEvents(recording: Recording, index: number): string {
  const first = recording.frames[Math.max(0, index - 10)];
  const last = recording.frames[Math.min(recording.frames.length - 1, index + 10)];
  return [
    ...new Set(
      recording.events
        .filter(
          (event) => event.atMs >= (first?.startedAtMs ?? 0) && event.atMs < (last?.endedAtMs ?? 0),
        )
        .map((event) => event.label),
    ),
  ]
    .slice(0, 3)
    .join(" · ");
}
