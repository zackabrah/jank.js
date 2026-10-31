import type { Recording } from "../recordings/recording.ts";
import { buildCounterTimeline, counterAtTime, counterCatalog } from "./counter-timeline.ts";
import { summarizeGpuCoverage } from "./gpu-coverage.ts";
import { inspectFrame } from "./summary.ts";

/** Context spans ten retained frames on either side, including gaps between them. */
export function nearbyEvents(recording: Recording, elapsedMs: number) {
  const origin = recording.frames[0]?.startedAtMs ?? 0;
  const atMs = origin + elapsedMs;
  const following = recording.frames.findIndex((frame) => frame.endedAtMs > atMs);
  const index = following < 0 ? recording.frames.length - 1 : following;
  const start = recording.frames[Math.max(0, index - 10)]?.startedAtMs;
  const end = recording.frames[Math.min(recording.frames.length - 1, index + 10)]?.endedAtMs;
  if (start === undefined || end === undefined) {
    return [];
  }
  return recording.events
    .map((event, index) => ({
      ...event,
      index,
      elapsedMs: event.atMs - origin,
      offsetMs: event.atMs - atMs,
    }))
    .filter((event) => event.atMs >= start && event.atMs < end)
    .sort((a, b) => a.atMs - b.atMs);
}

/** A diagnostic excerpt, not an importable recording. Raw GPU clock and rejection data stay intact. */
export function frameEvidence(recording: Recording, frameId: number | null) {
  const frame = recording.frames.find((frame) => frame.id === frameId);
  if (!frame) {
    return null;
  }
  const elapsedMs = frame.startedAtMs - (recording.frames[0]?.startedAtMs ?? 0);
  const counters = buildCounterTimeline(recording, counterCatalog(recording, null), {
    fromMs: 0,
    toMs: elapsedMs,
  });
  return {
    format: "jank.js-frame-evidence",
    notes:
      "Diagnostic excerpt; null means unknown. Counter observations are at frame start, with age and change from the previous valid sample. Counter units are not recorded. GPU clocks are separate from CPU time. Empty GPU observations do not mean zero work.",
    metadata: recording.metadata,
    clock: recording.clock,
    channels: recording.channels,
    budgetMs: 1000 / recording.targetFps,
    elapsedMs,
    frame,
    summary: inspectFrame(recording, frame.id),
    recordingCoverage: { truncated: recording.truncated, gpu: summarizeGpuCoverage(recording) },
    gpu: recording.gpu.filter((sample) => sample.frameId === frame.id),
    counters: counters.lanes.map((lane) => ({
      identity: lane.identity,
      observation: counterAtTime(lane, elapsedMs),
    })),
    counterSamplesInFrame: recording.counters.filter(
      (sample) => sample.atMs >= frame.startedAtMs && sample.atMs < frame.endedAtMs,
    ),
    nearbyEvents: nearbyEvents(recording, elapsedMs),
  };
}
