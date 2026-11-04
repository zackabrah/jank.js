import { parseComparison } from "../compare/model.ts";
import { MAX_RECORDING_BYTES, parseRecording } from "../recording/format.ts";

export function parseViewerDocument(json: string) {
  if (
    json.length > MAX_RECORDING_BYTES ||
    new TextEncoder().encode(json).length > MAX_RECORDING_BYTES
  )
    throw new Error("File exceeds the 32 MiB import limit.");
  const root: unknown = JSON.parse(json);
  return root &&
    typeof root === "object" &&
    "format" in root &&
    root.format === "jank.js-comparison"
    ? parseComparison(json)
    : parseRecording(json);
}
