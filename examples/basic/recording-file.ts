import { parseRecording } from "../../packages/jank/src/index.ts";

/** Import is validation only; a failure leaves the last successful summary intact. */
export function bindRecordingFile(
  input: HTMLInputElement,
  summary: HTMLElement,
  error: HTMLElement,
): () => void {
  let generation = 0;
  async function read(): Promise<void> {
    const current = ++generation;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    error.hidden = true;
    try {
      const recording = await readRecording(file);
      if (current !== generation) {
        return;
      }
      summary.textContent = `Valid schema ${recording.schemaVersion} · ${recording.frames.length} frames · ${recording.counters.length} counter samples · ${recording.gpu.length} GPU samples${recording.truncated ? " · truncated" : ""}`;
    } catch (cause) {
      if (current === generation) {
        error.textContent = cause instanceof Error ? cause.message : "Unable to read recording.";
        error.hidden = false;
      }
    }
  }
  const change = () => {
    void read();
  };
  input.addEventListener("change", change);
  return () => {
    generation += 1;
    input.removeEventListener("change", change);
  };
}

async function readRecording(file: File) {
  if (file.size > 32 * 1024 * 1024) {
    throw new Error("This demo accepts recording files up to 32 MiB.");
  }
  const result = parseRecording(await file.text());
  if (!result.ok) {
    throw new Error(result.problem.message);
  }
  return result.recording;
}
