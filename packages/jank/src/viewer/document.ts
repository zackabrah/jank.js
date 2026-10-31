import { readComparison } from "../comparison/codec.ts";
import { readRecording } from "../recordings/codec.ts";
import { parseJsonData } from "../recordings/json.ts";
import { object } from "../recordings/read-values.ts";
import type { ViewerDocument, ViewerState } from "./viewer.ts";

export function parseViewerDocument(json: string) {
  return parseJsonData<ViewerDocument>(json, (value) => {
    const data = object(value, "$");
    return data.format === "jank.js-comparison"
      ? { kind: "comparison", comparison: readComparison(data) }
      : { kind: "recording", recording: readRecording(data) };
  });
}

export function initialViewerState(
  input: ViewerDocument,
): Extract<ViewerState, { status: "loaded" }> {
  const comparison = input.kind === "comparison" ? input.comparison : null;
  const recording =
    input.kind === "recording" ? input.recording : (comparison?.trials[0]?.recording ?? null);
  return {
    status: "loaded",
    recording,
    comparison,
    selectedTrialIndex: comparison && comparison.trials.length > 0 ? 0 : null,
    selectedFrameId: recording?.frames[0]?.id ?? null,
    firstVisibleIndex: 0,
    visibleFrameCount: 100,
    comparisonElapsedMs: 0,
    comparisonWindowMs: 1000,
  };
}
