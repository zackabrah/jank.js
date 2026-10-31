import { recordingLimits } from "./limits.ts";
import { RecordingError } from "./read-values.ts";
import type { RecordingProblem } from "./recording.ts";

export function checkJsonSize(json: string): void {
  let bytes = 0;
  for (const character of json) {
    const point = character.charCodeAt(0);
    if (character.length === 2) {
      bytes += 4;
    } else if (point <= 0x7f) {
      bytes += 1;
    } else if (point <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > recordingLimits.fileBytes) {
      throw new RecordingError({
        code: "too-large",
        path: "$",
        message: "File exceeds 32 MiB of UTF-8",
      });
    }
  }
}

export function parseJsonData<T>(
  json: string,
  read: (value: unknown) => T,
):
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: RecordingProblem } {
  try {
    checkJsonSize(json);
    const value: unknown = JSON.parse(json);
    return { ok: true, value: read(value) };
  } catch (error) {
    if (error instanceof RecordingError) {
      return { ok: false, problem: error.problem };
    }
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        problem: { code: "invalid-json", path: "$", message: "File is not valid JSON" },
      };
    }
    throw error;
  }
}
