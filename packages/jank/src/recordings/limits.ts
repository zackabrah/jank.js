export const recordingLimits = {
  fileBytes: 32 * 1024 * 1024,
  frames: 6000,
  beforeFrames: 599,
  afterFrames: 5400,
  archive: 10,
  counters: 1200,
  events: 200,
  counterValues: 64,
  gpuPasses: 256,
  detailLength: 2000,
} as const;
