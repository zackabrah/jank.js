import { serializeRecording } from "../recordings/codec.ts";
import type { Recording } from "../recordings/recording.ts";

/** Keep at most one object URL alive; replacing or disposing the panel releases it. */
export function createDownload(document: Document): {
  save(recording: Recording): void;
  saveJson(json: string, filename: string): void;
  dispose(): void;
} {
  let previousUrl: string | null = null;
  function dispose(): void {
    if (previousUrl !== null) {
      URL.revokeObjectURL(previousUrl);
      previousUrl = null;
    }
  }
  function saveJson(json: string, filename: string): void {
    dispose();
    previousUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = previousUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
  }
  return {
    save: (recording) =>
      saveJson(serializeRecording(recording), `jank-${recording.capture.kind}.json`),
    saveJson,
    dispose,
  };
}
