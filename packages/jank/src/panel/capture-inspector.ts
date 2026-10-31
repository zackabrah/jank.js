import type { Recording } from "../recordings/recording.ts";
import { createViewer } from "../viewer/create-viewer.ts";

/** An on-demand detached recording; the host loop and source panel keep running. */
export function createCaptureInspector(document: Document) {
  let close: (() => void) | null = null;
  return {
    open(recording: Recording, returnFocus: HTMLElement): void {
      close?.();
      const dialog = document.createElement("dialog");
      dialog.className = "jl jank-capture-inspector";
      dialog.setAttribute("aria-label", "Captured slow frame");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "jl-btn";
      button.textContent = "Close capture inspector";
      dialog.append(button);
      document.body.append(dialog);
      const viewer = createViewer({ container: dialog });
      function dispose(): void {
        viewer.dispose();
        dialog.removeEventListener("close", dispose);
        button.removeEventListener("click", dismiss);
        dialog.remove();
        close = null;
        if (returnFocus.isConnected) {
          returnFocus.focus();
        }
      }
      function dismiss(): void {
        dialog.close();
      }
      close = () => {
        dialog.close();
        dispose();
      };
      button.addEventListener("click", dismiss);
      dialog.addEventListener("close", dispose);
      try {
        viewer.load(recording);
        dialog.showModal();
        button.focus();
      } catch (error) {
        dispose();
        throw error;
      }
    },
    dispose(): void {
      close?.();
    },
  };
}
