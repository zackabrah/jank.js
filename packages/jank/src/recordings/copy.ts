import { copyCounterSample, copyFrame } from "../core/frames.ts";
import { copyGpuSample } from "../core/gpu.ts";
import type { Recording } from "./recording.ts";

/** Trusted recorded data needs a boundary copy, not serialization and revalidation. */
export function copyRecording(recording: Recording): Recording {
  const { metadata } = recording;
  const { environment } = metadata;
  return {
    ...recording,
    clock: { ...recording.clock },
    metadata: {
      ...metadata,
      application: metadata.application === null ? null : { ...metadata.application },
      environment: {
        ...environment,
        timer: { ...environment.timer },
        viewport: environment.viewport === null ? null : { ...environment.viewport },
      },
    },
    capture: { ...recording.capture },
    frames: recording.frames.map(copyFrame),
    channels: recording.channels.map((channel) => ({ ...channel })),
    counters: recording.counters.map(copyCounterSample),
    events: recording.events.map((event) => ({ ...event })),
    gpu: recording.gpu.map(copyGpuSample),
  };
}
