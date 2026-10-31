import type { CounterSample } from "../../packages/jank/src/core/frames.ts";
import { comparisonReportFixture } from "./comparison-report.ts";

export function counterComparisonFixture() {
  const report = comparisonReportFixture();
  return {
    ...report,
    trials: report.trials.map((trial) => {
      const origin = trial.variant === "B" ? 5000 : 0;
      const multiplier = trial.variant === "B" ? 2 : 1;
      const counters: CounterSample[] = [0, 100, 200, 300, 400, 500, 600].map((elapsed) => {
        const base = { atMs: origin + elapsed, channelId: "renderer" };
        if (elapsed === 200) {
          return { ...base, status: "error", message: "Renderer unavailable" };
        }
        const drawCalls = new Map([
          [0, 10],
          [100, null],
          [400, 0],
          [500, -5],
          [600, 15],
        ]).get(elapsed);
        const values = {
          objects: elapsed === 400 ? 0 : 100 + elapsed,
          active: true,
          mode: "test",
          ...(trial.variant === "B" ? { textures: 4 } : {}),
        };
        if (drawCalls === undefined) {
          return { ...base, status: "ready", values };
        }
        const scaled = drawCalls === null ? null : drawCalls * multiplier;
        return { ...base, status: "ready", values: { drawCalls: scaled, ...values } };
      });
      return {
        ...trial,
        recording: {
          ...trial.recording,
          channels: [...trial.recording.channels, { id: "renderer", label: "Renderer" }],
          frames: trial.recording.frames.map((frame) => ({
            ...frame,
            startedAtMs: frame.startedAtMs + origin,
            endedAtMs: frame.endedAtMs + origin,
            scopes: frame.scopes.map((scope) => ({
              ...scope,
              startedAtMs: scope.startedAtMs + origin,
              endedAtMs: scope.endedAtMs + origin,
            })),
          })),
          counters,
          events: [],
        },
      };
    }),
  };
}
