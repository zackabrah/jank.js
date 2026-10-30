import { gpuIntervalLimits } from "../core/gpu.ts";
import { collectionLimits } from "../core/limits.ts";

const counterRounds = 1200;

export const recordingLimits = {
  fileBytes: 32 * 1024 * 1024,
  frames: 6000,
  beforeFrames: 599,
  afterFrames: 5400,
  archive: 10,
  counterRounds,
  counters: counterRounds * collectionLimits.channels,
  events: 200,
  counterValues: 64,
  gpuPasses: gpuIntervalLimits.passes,
  gpuIntervals: 16_384,
  detailLength: 2000,
} as const;
