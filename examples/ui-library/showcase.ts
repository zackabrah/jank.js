/// <reference types="vite/client" />
import { createTabs } from "../../packages/junkui/src/index.ts";
import "../../packages/jank/src/panel/panel.css";
import "./showcase.css";
import { createProfilerPreview } from "./profiler-preview.ts";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing library element: ${id}`);
  }
  // Element IDs and types belong to this page's static template.
  return found as T;
}

const preview = createProfilerPreview({
  full: element("full-preview"),
  mini: element("mini-preview"),
  line: element("line-preview"),
});
const tabs = createTabs({
  tablist: element("control-tabs"),
  tabs: ["buttons", "fields", "details", "disabled"].map((id) => ({
    id,
    button: element<HTMLButtonElement>(`${id}-tab`),
    panel: element(`${id}-panel`),
  })),
  selectedId: "buttons",
});
const listeners = new AbortController();
const { signal } = listeners;
const media = matchMedia("(prefers-reduced-motion: reduce)");
const streamButton = element<HTMLButtonElement>("stream-toggle");
let paused = media.matches;
let frameRequest = 0;

function showMotion(): void {
  streamButton.textContent = paused ? "Resume sample stream" : "Pause sample stream";
  element("motion-status").textContent = media.matches
    ? "Reduced motion is enabled. The stream starts paused and graph gliding is disabled."
    : "Full motion is enabled. Graphs glide as new samples arrive.";
}
function tick(): void {
  if (!paused && !document.hidden) {
    preview.tick();
  }
  frameRequest = requestAnimationFrame(tick);
}
streamButton.addEventListener(
  "click",
  () => {
    paused = !paused;
    showMotion();
  },
  { signal },
);
media.addEventListener(
  "change",
  () => {
    if (media.matches) {
      paused = true;
    }
    showMotion();
  },
  { signal },
);
element("advance-stream").addEventListener("click", () => preview.advance(), { signal });
const loadingExample = element<HTMLSelectElement>("loading-example");
loadingExample.addEventListener("change", () => preview.setLoadingExample(loadingExample.value), {
  signal,
});
element("spike").addEventListener("click", () => preview.spike(), { signal });
element("marker").addEventListener("click", () => preview.marker(), { signal });
const gpuExample = element<HTMLSelectElement>("gpu-example");
gpuExample.addEventListener("change", () => preview.setGpuExample(gpuExample.value), { signal });
const guides = element("guides");
guides.addEventListener(
  "click",
  () => {
    const enabled = guides.getAttribute("aria-pressed") !== "true";
    guides.setAttribute("aria-pressed", String(enabled));
    document.body.dataset.guides = String(enabled);
    element("button-result").textContent = enabled
      ? "Preview guides enabled below."
      : "Preview guides hidden.";
  },
  { signal },
);
for (const id of ["primary-example", "secondary-example", "small-example", "icon-example"]) {
  element(id).addEventListener(
    "click",
    () => {
      preview.marker();
      element("button-result").textContent =
        "Action received. An event marker was added to the profiler.";
    },
    { signal },
  );
}
const form = element<HTMLFormElement>("example-form");
form.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const data = new FormData(form);
    element("field-result").textContent =
      `${data.get("project")} · ${data.get("budget")} ms · ${data.get("quality")} — valid.`;
  },
  { signal },
);

function renderTokens(): void {
  const style = getComputedStyle(document.body);
  const names = [
    "ink",
    "line",
    "line-strong",
    "control",
    "faint",
    "dim",
    "muted",
    "text",
    "bright",
  ];
  const panel = element("full-preview").querySelector(".jank");
  if (!panel) {
    throw new Error("Profiler preview did not mount");
  }
  const tokens = names.map((name) => ({
    name,
    property: `--jl-${name}`,
    value: style.getPropertyValue(`--jl-${name}`).trim(),
  }));
  tokens.push({
    name: "over budget",
    property: "--jank-warning",
    value: getComputedStyle(panel).getPropertyValue("--jank-warning").trim(),
  });
  for (const token of tokens) {
    const cell = document.createElement("div");
    cell.className = "color";
    cell.dataset.colorToken = token.property;
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.backgroundColor = token.value;
    const name = document.createElement("div");
    name.textContent = token.name;
    const value = document.createElement("code");
    value.textContent = token.value;
    const property = document.createElement("code");
    property.textContent = token.property;
    cell.append(swatch, name, value, property);
    element("palette").append(cell);
  }
  for (const [label, token] of [
    ["Body type", "size-body"],
    ["Label type", "size-label"],
    ["Button height", "button-height"],
    ["Input height", "input-height"],
    ["Tab height", "tab-height"],
    ["Corner radius", "radius"],
  ]) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label ?? "";
    const value = document.createElement("dd");
    value.textContent = style.getPropertyValue(`--jl-${token}`).trim();
    row.append(term, value);
    element("dimensions").append(row);
  }
}
renderTokens();
showMotion();
frameRequest = requestAnimationFrame(tick);
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(frameRequest);
    listeners.abort();
    tabs.dispose();
    preview.dispose();
  },
  { once: true },
);
document.body.dataset.ready = "true";
