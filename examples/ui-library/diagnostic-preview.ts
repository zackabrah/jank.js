import type {
  TemporalSnapshot,
  TemporalSource,
  VisibilitySource,
} from "../../packages/jank/src/index.ts";

/** Explicitly synthetic source data for the standalone gallery and matched reference review. */
export function createDiagnosticPreview(): {
  visibility: VisibilitySource;
  temporal: TemporalSource;
} {
  let enabled = true;
  let debugBounds = false;
  let instancesEnabled = true;
  let objectMotion = true;
  let debugView: TemporalSnapshot["debugView"] = "none";
  return {
    visibility: {
      read: () => ({
        enabled,
        debugBounds,
        note: "SIMULATED visibility / instances; gallery controls do not change a renderer.",
        views: [{ name: "Main", tested: 20, visible: enabled ? 12 : 20, culled: enabled ? 8 : 0 }],
        distance: { range: 80, culled: enabled ? 2 : 0 },
        instances: {
          enabled: instancesEnabled,
          hierarchies: 3,
          nodes: 24,
          prepared: 18,
          cacheHits: 6,
          views: [
            {
              name: "Main",
              candidates: 1000,
              visible: instancesEnabled ? 700 : 1000,
              culled: instancesEnabled ? 300 : 0,
              rejectedLeaves: 4,
              sampleAgeFrames: 2,
            },
          ],
        },
      }),
      setEnabled: (value) => {
        enabled = value;
      },
      setDebugBounds: (value) => {
        debugBounds = value;
      },
      setInstancesEnabled: (value) => {
        instancesEnabled = value;
      },
    },
    temporal: {
      read: () => ({
        objectMotion,
        debugView,
        eligibleBatches: 20,
        rigidBatches: objectMotion ? 18 : 0,
        rejectedBatches: objectMotion ? 2 : 20,
        note: "SIMULATED temporal diagnostics; no GPU reconstruction in this gallery.",
      }),
      setEnabled: (value) => {
        objectMotion = value;
      },
      setDebugView: (value) => {
        debugView = value;
      },
    },
  };
}
