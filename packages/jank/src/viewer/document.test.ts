import { expect, it } from "vitest";
import { comparisonReportFixture } from "../../../../tests/fixtures/comparison-report.ts";
import { recordingFixture } from "../../../../tests/fixtures/recording.ts";
import { initialViewerState, parseViewerDocument } from "./document.ts";

it("opens both file kinds with independent trial identity and empty evidence", () => {
  const recording = parseViewerDocument(JSON.stringify(recordingFixture()));
  const comparison = parseViewerDocument(JSON.stringify(comparisonReportFixture()));
  expect(recording.ok && recording.value.kind).toBe("recording");
  expect(comparison.ok && comparison.value.kind).toBe("comparison");
  if (!recording.ok || !comparison.ok) {
    throw new Error("Expected valid documents");
  }
  expect(initialViewerState(recording.value).selectedTrialIndex).toBeNull();
  expect(initialViewerState(comparison.value).selectedTrialIndex).toBe(0);
  const empty = initialViewerState({
    kind: "comparison",
    comparison: { ...comparisonReportFixture(), status: "cancelled", trials: [] },
  });
  expect(empty.recording).toBeNull();
  expect(empty.selectedFrameId).toBeNull();
});

it("opens automatic recordings at their retained trigger with surrounding frames visible", () => {
  const source = recordingFixture();
  const recording = {
    ...source,
    capture: {
      kind: "automatic" as const,
      triggerFrameId: 2,
      thresholdMs: 10,
      beforeFrames: 1,
      afterFrames: 0,
    },
  };
  const state = initialViewerState({ kind: "recording", recording });
  expect(state.selectedFrameId).toBe(2);
  expect(state.comparisonElapsedMs).toBe(16);
  expect(state.firstVisibleIndex).toBe(0);
  expect(
    initialViewerState({ kind: "recording", recording: { ...recording, frames: [] } })
      .selectedFrameId,
  ).toBeNull();
});

it("shows a wider context around automatic triggers in longer recordings", () => {
  const fixture = recordingFixture();
  const template = fixture.frames[0];
  if (!template) {
    throw new Error("Missing frame");
  }
  const recording = {
    ...fixture,
    frames: Array.from({ length: 241 }, (_, index) => ({
      ...template,
      id: index + 1,
      startedAtMs: index * 16,
      endedAtMs: (index + 1) * 16,
      scopes: [],
    })),
    capture: {
      kind: "automatic" as const,
      triggerFrameId: 121,
      thresholdMs: 10,
      beforeFrames: 120,
      afterFrames: 120,
    },
  };
  const state = initialViewerState({ kind: "recording", recording });
  expect(state.visibleFrameCount).toBe(200);
  expect(state.firstVisibleIndex).toBe(20);
  expect(state.selectedFrameId).toBe(121);
});
