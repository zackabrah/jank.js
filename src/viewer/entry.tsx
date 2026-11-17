import { mountShadowView } from "../shadow-view.ts";
import { RecordingViewer } from "./view.tsx";
import styles from "./viewer.css?inline";

const container = document.getElementById("viewer");
if (!container) throw new Error("Missing viewer root");
const view = mountShadowView(container, styles);
view.render(
  <>
    <style>{styles}</style>
    <RecordingViewer />
  </>,
);
import.meta.hot?.dispose(view.destroy);
