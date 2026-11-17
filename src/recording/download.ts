import { serializeRecording } from "./format.ts";
import type { PerformanceRecording } from "./types.ts";

export function downloadRecording(
  document: Document,
  recording: PerformanceRecording,
  name: string,
) {
  downloadJson(document, serializeRecording(recording), name);
}

export function downloadJson(document: Document, json: string, name: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
