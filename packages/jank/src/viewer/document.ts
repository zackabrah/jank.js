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
  const trigger =
    input.kind === "recording" && recording?.capture.kind === "automatic"
      ? recording.capture.triggerFrameId
      : null;
  const index = Math.max(0, recording?.frames.findIndex((frame) => frame.id === trigger) ?? 0);
  const selected = recording?.frames[index];
  const visibleFrameCount = trigger !== null && (recording?.frames.length ?? 0) > 100 ? 200 : 100;
  return {
    status: "loaded",
    recording,
    comparison,
    selectedTrialIndex: comparison && comparison.trials.length > 0 ? 0 : null,
    selectedFrameId: selected?.id ?? null,
    firstVisibleIndex: Math.max(
      0,
      Math.min(index - visibleFrameCount / 2, (recording?.frames.length ?? 0) - visibleFrameCount),
    ),
    visibleFrameCount,
    comparisonElapsedMs: (selected?.startedAtMs ?? 0) - (recording?.frames[0]?.startedAtMs ?? 0),
    comparisonWindowMs: 1000,
    comparisonWindowStartMs: 0,
  };
}
