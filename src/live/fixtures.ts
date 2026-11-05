import { type LiveSnapshot, measured } from "./model.ts";

/** Explicit design-review samples; never used as measurements in live mode. */
export function liveFixture(empty = false, missingPass = false): LiveSnapshot {
  let at = 0;
  const snapshot: LiveSnapshot = {
    diagnostics: {
      frames: empty
        ? []
        : Array.from({ length: 180 }, (_, index) => {
            const interval = index === 137 ? 32 : index % 3 === 0 ? 17.9 : 16 + (index % 4) / 10;
            const from = at;
            at += interval;
            return {
              id: 1067 + index,
              at,
              interval,
              coverage: "complete" as const,
              scopes: [
                { system: "simulation", label: "Simulation", start: from + 1, end: from + 3.45 },
                { system: "render", label: "Render submission", start: from + 4, end: from + 7.76 },
              ],
              overhead: { collectionMs: 0.02, refreshMs: index % 15 === 0 ? 0.6 : 0 },
            };
          }),
      systems: [
        { id: "simulation", label: "Simulation", values: { entities: 128 } },
        {
          id: "render",
          label: "Render submission",
          values: {
            drawCalls: 128,
            points: 0,
            widthPx: 1280,
            trackedStorageEstimateBytes: 1572864,
            computeCalls: null,
            workloadPaused: false,
            configuredInstances: 144,
            activeInstances: 144,
            instanceCapacity: 2048,
            meshVisible: true,
            frustumCullingEnabled: false,
            instanceDrawCalls: 2,
            uniqueSubmittedInstances: 144,
            submittedInstances: 288,
            visibleInstances: null,
            temporalEnabled: true,
            temporalHistoryValid: true,
            temporalHistoryAgeFrames: 32,
            temporalHistoryResetReason: null,
          },
        },
      ],
      budget: { frameMs: 1000 / 60 },
      recording: false,
      capture: { mode: "recent", state: "idle" },
    },
    gpu: empty
      ? null
      : {
          status: "ready",
          completeness: "complete",
          expected: missingPass ? 2 : 3,
          timed: missingPass ? 2 : 3,
          sampleFrame: 150,
          ageFrames: 2,
          dropped: 0,
          timedWork: measured(missingPass ? 4.4 : 6.5),
          busy: measured(missingPass ? 4.4 : 6.5),
          span: measured(7.2),
          passes: [
            { id: "cloud", label: "Cloud panorama", kind: "render", duration: measured(3.2) },
            {
              id: "ocean",
              label: "Ocean FFT",
              kind: "compute",
              duration: missingPass
                ? {
                    status: "not-observed",
                    reason: "No compute invocation was expected in this complete sample",
                  }
                : measured(2.1),
            },
            { id: "resolve", label: "Temporal resolve", kind: "render", duration: measured(1.2) },
          ],
        },
  };
  const spike = snapshot.diagnostics.frames[137];
  snapshot.diagnostics.events = spike
    ? [
        { at: 1000, label: "Loaded", detail: "Reference scene ready." },
        { at: spike.at - 8, label: "Wave 3", detail: "Spawned 128 reference entities." },
        { at: spike.at - 8, label: "Spawn complete", detail: "Two events share this frame." },
      ]
    : [];
  return snapshot;
}
