import { parseRecording } from "./format.ts";

export function recordingFixture(count = 3) {
  let at = 0;
  const recording = parseRecording(
    JSON.stringify({
      format: "world-performance-recording",
      version: 1,
      units: "milliseconds",
      frameCapacity: 6000,
      frames: Array.from({ length: count }, (_, index) => {
        const interval = index % 3 === 1 ? 42 : 16;
        at += interval;
        return { at, interval, update: 2, render: 1 };
      }),
      samples: [],
      systems: [],
      events: [],
    }),
  );
  recording.metadata.importedFromVersion = null;
  recording.capture.mode = "manual";
  for (const frame of recording.frames) {
    frame.coverage = "complete";
    frame.scopes = [
      {
        system: "simulation",
        label: "Simulation",
        start: frame.at - frame.interval,
        end: frame.at - frame.interval + 2,
      },
    ];
  }
  return recording;
}
