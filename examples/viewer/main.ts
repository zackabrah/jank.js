import { createViewer } from "../../packages/jank/src/index.ts";
import "../../packages/jank/src/viewer/viewer.css";
import "./page.css";

const container = document.querySelector<HTMLElement>("#viewer");
if (!container) {
  throw new Error("Missing viewer container");
}
const viewer = createViewer({ container, receiveFromOpener: true });
document.body.dataset.ready = "true";
window.addEventListener("pagehide", () => viewer.dispose(), { once: true });
