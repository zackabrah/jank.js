import { render } from "preact";
import styles from "./annotations.css?inline";
import { Annotations } from "./annotations.tsx";

const host = document.createElement("div");
host.id = "jank-annotations";
const root = host.attachShadow({ mode: "open" });
document.body.append(host);
render(
  <>
    <style>{styles}</style>
    <Annotations host={host} />
  </>,
  root,
);
import.meta.hot?.accept();
import.meta.hot?.dispose(() => {
  render(null, root);
  host.remove();
});
