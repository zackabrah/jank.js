import type { SavedCapture } from "../capture/controller.ts";
import { parseRecording } from "../recording/format.ts";
import { mountShadowView } from "../shadow-view.ts";
import { RecordingViewer } from "./view.tsx";
import styles from "./viewer.css?inline";

export function openRecordingViewer(document: Document, capture: SavedCapture) {
  const recording = parseRecording(JSON.stringify(capture.recording));
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", `Recording viewer · Capture C${capture.id}`);
  Object.assign(dialog.style, {
    width: "100%",
    height: "100%",
    maxWidth: "none",
    maxHeight: "none",
    margin: "0",
    padding: "0",
    border: "0",
  });
  document.body.append(dialog);
  const view = mountShadowView(dialog, styles);
  let closed = false;
  const destroy = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    view.destroy();
    dialog.remove();
  };
  dialog.addEventListener("close", destroy, { once: true });
  view.render(
    <>
      <style>{styles}</style>
      <RecordingViewer initial={recording} name={`Capture C${capture.id}`} onClose={destroy} />
    </>,
  );
  dialog.showModal();
  return destroy;
}
