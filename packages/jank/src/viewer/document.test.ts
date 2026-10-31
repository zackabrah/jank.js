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
