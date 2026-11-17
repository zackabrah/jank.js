import "./style.css";
import { render } from "preact";
import { App } from "./app.tsx";

const container = document.getElementById("app");
if (!container) throw new Error("Missing app container");
render(<App />, container);
import.meta.hot?.dispose(() => render(null, container));

if (import.meta.env.DEV) void import("../devtools/index.tsx");
