import { type ComparisonScenario, comparisonFixture } from "../src/compare/fixtures.ts";
import { parseComparison } from "../src/compare/model.ts";
import { gpuFixture } from "../src/gpu/fixtures.ts";
import { recordingFixture } from "../src/recording/fixtures.ts";
import { parseRecording } from "../src/recording/format.ts";
import { mountShadowView } from "../src/shadow-view.ts";
import { RecordingViewer } from "../src/viewer/view.tsx";
import styles from "../src/viewer/viewer.css?inline";

const root = document.getElementById("viewer");
if (!root) throw new Error("Missing viewer review root");
const query = new URLSearchParams(location.search);
const comparisonScenario =
  (
    [
      "mixed",
      "faster",
      "same",
      "inconclusive",
      "gpu-gap",
      "scope-shifts",
      "stopped",
      "low-samples",
      "low-window",
    ] satisfies ComparisonScenario[]
  ).find((value) => value === query.get("comparison")) ?? "mixed";
const comparison = query.has("comparison") ? comparisonFixture(comparisonScenario) : null;
if (comparison && query.has("spikes")) {
  for (const trial of comparison.trials) {
    let at = trial.measurementStartMs;
    for (const [index, frame] of trial.recording.frames.entries()) {
      const interval =
        (trial.variant === "A" ? 24 : 22) +
        Math.sin(index / 3) * 2 +
        ([8, 26, 38].includes(index) ? (trial.variant === "A" ? 24 : 14) : 0);
      const offset = at - (frame.at - frame.interval);
      for (const scope of frame.scopes) {
        scope.start += offset;
        scope.end += offset;
      }
      at += interval;
      Object.assign(frame, { at, interval });
    }
    trial.measurementEndMs = at;
  }
}
if (comparison)
  for (const trial of comparison.trials) {
    trial.recording.samples = trial.recording.frames.flatMap((frame, index) =>
      index % 5
        ? []
        : [
            {
              at: frame.at - frame.interval,
              systems: [
                {
                  id: "simulation",
                  label: "Simulation",
                  cpu: 0,
                  peak: 0,
                  values: {
                    bodies: index === 20 ? null : (trial.variant === "A" ? 64 : 128) + index,
                    balance: index - 25,
                  },
                },
              ],
            },
          ],
    );
    trial.recording.systems = trial.recording.samples.at(-1)?.systems ?? [];
    if (query.has("lane-states")) {
      const partial = trial.recording.frames[1];
      if (partial) {
        partial.coverage = "truncated";
        partial.droppedScopes = 1;
      }
      const gpu = trial.recording.gpuTiming;
      if (gpu)
        gpu.frames = gpu.frames
          .filter((_, index) => index !== 1)
          .map((frame, index) => {
            if (index === 3) return { ...frame, inventory: "unknown", invocations: [] };
            if (index === 4) return { ...frame, invocations: [] };
            const invocation = frame.invocations[0];
            if (invocation && index < 3)
              Object.assign(
                invocation,
                index === 0
                  ? { milliseconds: 0, startMs: 0, endMs: 0 }
                  : {
                      state: index === 1 ? "pending" : "rejected",
                      milliseconds: null,
                      startMs: null,
                      endMs: null,
                      reason: index === 1 ? "GPU readback pending" : "GPU counter reset",
                    },
              );
            return frame;
          });
    }
    if (query.has("many-lanes"))
      for (const frame of trial.recording.frames) {
        for (let index = 0; index < 30; index++)
          frame.scopes.push({
            system: `worker-${index}`,
            label: `Worker ${index}`,
            start: frame.at - frame.interval,
            end: frame.at - frame.interval + 0.1,
          });
      }
  }
const recording = recordingFixture(query.has("large") ? 6000 : 360);
let at = 0;
for (const [index, frame] of recording.frames.entries()) {
  const interval = query.has("dense")
    ? 40
    : index === 242
      ? 66.6
      : index === 167
        ? 40
        : index === 335
          ? 48
          : 16.6;
  const start = at;
  at += interval;
  Object.assign(frame, {
    id: 1001 + index * 2,
    at,
    interval,
    scopes: [
      { system: "simulation", label: "Simulation", start, end: start + 1.5 },
      { system: "animation", label: "Animation", start: start + 1.5, end: start + 2 },
      { system: "scene", label: "Scene update", start: start + 2, end: at - 0.5 },
      { system: "render", label: "Render submission", start: at - 0.5, end: at - 0.3 },
    ],
    overhead: { collectionMs: 0.02, refreshMs: 0.01 },
  });
}
recording.gpuTiming = {
  version: 1,
  frames: recording.frames
    .filter((_, index) => index % 4 !== 0)
    .map((frame) =>
      gpuFixture(
        frame.id,
        query.has("many-failures") || frame.id === 1485
          ? "rejected"
          : frame.id === 1335
            ? "pending"
            : "timed",
      ),
    ),
};
for (const frame of recording.gpuTiming.frames) {
  const scene = frame.invocations[0];
  if (scene?.state === "timed") {
    scene.milliseconds = frame.frameId % 7 === 0 ? 0 : 1.4 + (frame.frameId % 7) / 10;
    scene.startMs = 0;
    scene.endMs = scene.milliseconds;
  }
  frame.invocations.push({
    id: "compute:0",
    label: "Ocean FFT",
    kind: "compute",
    state: "timed",
    milliseconds: 4,
    startMs: 0,
    endMs: 4,
    reason: null,
  });
  if (frame.frameId % 3 !== 0)
    frame.invocations.push({
      id: "scene:1",
      label: "Scene",
      kind: "render",
      state: "timed",
      milliseconds: 0.5,
      startMs: 4,
      endMs: 4.5,
      reason: null,
    });
}
recording.samples = recording.frames.flatMap((frame, index) =>
  index % 6
    ? []
    : [
        {
          at: frame.at - frame.interval,
          systems: [
            {
              id: "renderer",
              label: "Renderer",
              cpu: 0,
              peak: 0,
              values: {
                drawCalls: 120 + (index % 36),
                triangles: 24000 + index * 120,
                memoryBytes: index === 240 ? null : 1048576 + index * 1024,
                uploads: index % 12 ? 0 : 2,
                balance: (index % 24) - 12,
                loading: index < 30,
                quality: index < 120 ? "medium" : "high",
              },
            },
          ],
        },
      ],
);
recording.systems = recording.samples.at(-1)?.systems ?? [];
recording.events = [25, 242, 242].flatMap((index, occurrence) => {
  const frame = recording.frames[index];
  return frame
    ? [
        {
          at: frame.at - frame.interval + 1,
          label: occurrence === 0 ? "Load complete" : occurrence === 1 ? "Wave 3" : "Camera reset",
          detail: "Simulated reference event",
        },
      ]
    : [];
});
recording.events.push({
  at: -100,
  label: "Before recording",
  detail: "No retained frame matches this event",
});
if (!query.has("large") && !query.has("dense")) {
  const trigger = recording.frames[242];
  const onset = recording.frames[query.has("episode") ? 238 : 242];
  const end = recording.frames[query.has("episode") ? 350 : 242];
  if (!trigger || !onset || !end) throw new Error("Missing capture fixture frames");
  const budgetMs = recording.budget.frameMs;
  recording.capture = {
    mode: "automatic",
    state: "idle",
    triggerFrame: trigger.id,
    thresholdMs: query.has("episode") ? budgetMs : 48,
    beforeFrames: 300,
    afterFrames: 120,
    cooldownMs: 5000,
    remainingFrames: 0,
    context: {
      rule: {
        mode: query.has("episode") ? "episode" : "spike",
        keep: query.has("episode") ? "episode" : "fixed",
        budgetMs,
        thresholdMs: 48,
        sustainedMs: 50,
        quietMs: 100,
        limitMs: 10000,
        beforeSeconds: 5,
        afterSeconds: 2,
        beforeFrames: 300,
        afterFrames: 120,
        cooldownMs: 5000,
      },
      onsetFrame: onset.id,
      onsetAt: onset.at - onset.interval,
      triggerAt: trigger.at,
      endFrame: end.id,
      endAt: end.at,
      reason: query.has("episode") ? "recovered" : "stopped",
      crossings: query.has("episode") ? 10 : 1,
      beforeFrames: 242,
      afterFrames: recording.frames.filter((frame) => frame.id > end.id).length,
    },
  };
}
if (query.has("mixed")) {
  for (const [index, frame] of (recording.gpuTiming?.frames ?? []).entries()) {
    if (index === 0) frame.inventory = "unknown";
    if (index === 1) {
      frame.invocations = [];
      frame.omitted = 2;
    }
  }
}
if (query.has("missing")) {
  delete recording.gpuTiming;
  recording.samples = [];
  recording.metadata.importedFromVersion = 1;
  for (const frame of recording.frames) {
    frame.coverage = "unavailable";
    frame.scopes = [];
  }
}
if (query.has("many-lanes")) {
  for (const frame of recording.frames) {
    for (let index = 0; index < 30; index++)
      frame.scopes.push({
        system: `worker-${index}`,
        label: `Worker ${index}`,
        start: frame.at - 1,
        end: frame.at - 0.9,
      });
  }
}
const view = mountShadowView(root, styles);
if (query.get("theme") === "light") root.firstElementChild?.classList.add("light-theme");
view.render(
  <>
    <style>{styles}</style>
    <RecordingViewer
      initial={
        comparison
          ? parseComparison(JSON.stringify(comparison))
          : parseRecording(JSON.stringify(recording))
      }
      name={
        query.has("comparison")
          ? "Reference comparison · simulated data"
          : "Reference recording · simulated data"
      }
    />
  </>,
);
import.meta.hot?.dispose(view.destroy);
