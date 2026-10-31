import {
  createPanel,
  createProfiler,
  type TemporalSnapshot,
  type VisibilitySnapshot,
} from "../../../packages/jank/src/index.ts";
import "../../../packages/jank/src/panel/panel.css";

let visibility: VisibilitySnapshot | null = {
  enabled: true,
  debugBounds: false,
  views: [
    { name: "Main", tested: 12, visible: 8, culled: 4 },
    { name: "Shadow", tested: 12, visible: 10, culled: 2 },
  ],
  distance: { range: 50, culled: 2 },
  instances: {
    enabled: true,
    hierarchies: 2,
    nodes: 15,
    prepared: 12,
    cacheHits: 4,
    views: [
      {
        name: "Main",
        candidates: 100,
        visible: 70,
        culled: 30,
        rejectedLeaves: 3,
        sampleAgeFrames: 2,
      },
    ],
  },
};
let temporal: TemporalSnapshot | null = {
  objectMotion: true,
  debugView: "none",
  eligibleBatches: 12,
  rigidBatches: 10,
  rejectedBatches: 2,
};
let fail = false;
const profiler = createProfiler();
const panel = createPanel({
  container: document.body,
  profiler,
  mode: "full",
  corner: "top-left",
  visibility: {
    read: () => {
      if (fail) {
        throw new Error("Host visibility unavailable");
      }
      return visibility;
    },
    setEnabled: (enabled) => {
      if (visibility) {
        visibility = { ...visibility, enabled };
      }
    },
    setDebugBounds: (debugBounds) => {
      if (visibility) {
        visibility = { ...visibility, debugBounds };
      }
    },
    setInstancesEnabled: (enabled) => {
      if (visibility?.instances) {
        visibility = { ...visibility, instances: { ...visibility.instances, enabled } };
      }
    },
  },
  temporal: {
    read: () => temporal,
    setEnabled: (objectMotion) => {
      if (temporal) {
        temporal = { ...temporal, objectMotion };
      }
    },
    setDebugView: (debugView) => {
      if (temporal) {
        temporal = { ...temporal, debugView };
      }
    },
  },
});
let timeMs = performance.now();
const fixture = {
  panel,
  state: () => ({ visibility, temporal }),
  fail: () => {
    fail = true;
  },
  clear: () => {
    visibility = null;
    temporal = null;
  },
  reverse: () => {
    if (visibility) {
      visibility = { ...visibility, views: [...visibility.views].reverse() };
    }
  },
  refresh: () => {
    timeMs += 1000;
    panel.refresh(timeMs);
  },
};
declare global {
  interface Window {
    integrationsFixture: typeof fixture;
  }
}
window.integrationsFixture = fixture;
fixture.refresh();
