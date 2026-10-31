import type { FrameSample } from "../core/frames.ts";
import type { GpuSample } from "../core/gpu.ts";
import type { Recording } from "../recordings/recording.ts";
import { measureFrameWork, type WorkIdentity, type WorkMeasurement } from "./frame-comparison.ts";

export interface TimelineWindow {
  readonly fromMs: number;
  readonly toMs: number;
}
export interface LaneSample extends WorkMeasurement {
  readonly frameId: number;
  readonly fromMs: number;
  readonly toMs: number;
}
export interface TimelineModel {
  readonly window: TimelineWindow;
  readonly originMs: number;
  readonly frames: readonly FrameSample[];
  readonly lanes: readonly {
    readonly identity: WorkIdentity;
    readonly samples: readonly LaneSample[];
  }[];
  readonly events: readonly {
    readonly elapsedMs: number;
    readonly label: string;
    readonly detail: string | null;
  }[];
}

export function fitTimelineWindow(
  fromMs: number,
  durationMs: number,
  totalMs: number,
): TimelineWindow {
  const total = Math.max(1, totalMs);
  const duration = Math.max(1, Math.min(total, durationMs));
  const start = Math.max(0, Math.min(fromMs, total - duration));
  return { fromMs: start, toMs: start + duration };
}
export function zoomTimelineWindow(
  window: TimelineWindow,
  zoom: { anchorMs: number; factor: number; totalMs: number },
): TimelineWindow {
  const duration = window.toMs - window.fromMs;
  const anchor = Math.max(window.fromMs, Math.min(window.toMs, zoom.anchorMs));
  const nextDuration = Math.max(1, Math.min(zoom.totalMs, duration * zoom.factor));
  return fitTimelineWindow(
    anchor - ((anchor - window.fromMs) / duration) * nextDuration,
    nextDuration,
    zoom.totalMs,
  );
}

/** Visible per-frame durations; GPU offsets never enter the CPU/elapsed coordinate system. */
export function buildTimeline(
  recording: Recording | null,
  catalog: readonly WorkIdentity[],
  window: TimelineWindow,
): TimelineModel {
  const originMs = recording?.frames[0]?.startedAtMs ?? 0;
  const frames =
    recording?.frames.filter(
      (frame) =>
        frame.endedAtMs - originMs > window.fromMs && frame.startedAtMs - originMs < window.toMs,
    ) ?? [];
  const gpuByFrame = new Map<number, GpuSample[]>();
  for (const sample of recording?.gpu ?? []) {
    if (sample.frameId === null) {
      continue;
    }
    const samples = gpuByFrame.get(sample.frameId) ?? [];
    samples.push(sample);
    gpuByFrame.set(sample.frameId, samples);
  }
  const lanes = catalog.map((identity) => ({ identity, samples: [] as LaneSample[] }));
  for (const frame of frames) {
    const measurements = measureFrameWork(frame, gpuByFrame.get(frame.id) ?? [], catalog);
    measurements.forEach((measurement, index) => {
      lanes[index]?.samples.push({
        ...measurement,
        frameId: frame.id,
        fromMs: frame.startedAtMs - originMs,
        toMs: frame.endedAtMs - originMs,
      });
    });
  }
  const events = (recording?.events ?? [])
    .map((event) => ({
      elapsedMs: event.atMs - originMs,
      label: event.label,
      detail: event.detail,
    }))
    .filter((event) => event.elapsedMs >= window.fromMs && event.elapsedMs < window.toMs);
  return { window, originMs, frames, lanes, events };
}
