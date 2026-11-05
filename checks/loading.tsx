import "./loading.css";
import { createCaptureController } from "../src/capture/controller.ts";
import { captureFixture } from "../src/capture/fixtures.ts";
import { mountLivePanel } from "../src/live/panel.tsx";
import { type LoadingScenario, loadingFixture } from "../src/loading/fixtures.ts";

const root = document.getElementById("app");
if (!root) throw new Error("Missing Loading review root");
root.innerHTML =
  '<h1 class="mb-3 text-heading-24">Loading review</h1><p class="mb-6 max-w-3xl text-copy-13">Simulated host snapshots, not real loads. Review overlapping operations, cold/warm comparisons, cache outcomes and missing timing. Select past sessions, freeze the display, or record alongside loading. Real Three.js loading integration follows separately.</p><div class="flex flex-wrap items-start gap-6"></div>';
const grid = root.querySelector("div");
if (!grid) throw new Error("Missing review grid");
const cleanup: (() => void)[] = [];
let closeViewer = () => {};
let disposed = false;
for (const theme of ["dark", "light"]) {
  const section = document.createElement("section");
  section.setAttribute("aria-label", `Loading review ${theme}`);
  const title = document.createElement("h2");
  title.className = "mb-3 text-heading-16";
  title.textContent = `Loading · ${theme}`;
  const label = document.createElement("label");
  label.htmlFor = `scenario-${theme}`;
  label.textContent = "Reference state";
  label.className = "mb-2 block text-label-13";
  const select = document.createElement("select");
  select.id = label.htmlFor;
  select.className =
    "focus-ring mb-3 h-8 rounded-md border border-jank-control bg-jank-surface px-2 text-label-13";
  for (const [value, text] of [
    ["loading", "In progress"],
    ["ready", "Ready"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["empty", "No sessions"],
    ["unknown", "Unknown wall time"],
    ["missing", "Aggregate only; timing and cache unavailable"],
    ["partial", "Partial timing and cache"],
    ["unmatched", "No comparable cold run"],
    ["disconnected", "No source"],
  ]) {
    if (value && text) select.add(new Option(text, value));
  }
  const container = document.createElement("div");
  section.append(title, label, select, container);
  grid.append(section);
  const fixture = captureFixture(12);
  const controller = createCaptureController(fixture.source);
  const panel = mountLivePanel(container, {
    capture: {
      controller,
      onOpen: async (capture) => {
        const { openRecordingViewer } = await import("../src/viewer/mount.tsx");
        if (disposed) return;
        closeViewer();
        closeViewer = openRecordingViewer(document, capture);
      },
    },
  });
  let loading = loadingFixture("loading");
  const refresh = () => {
    const diagnostics = fixture.source.snapshot();
    controller.refresh(diagnostics);
    panel.update({
      diagnostics,
      gpu: null,
      loading: select.value === "disconnected" ? null : loading,
    });
  };
  refresh();
  const host = container.firstElementChild;
  if (theme === "light") host?.classList.add("light-theme");
  host?.shadowRoot?.querySelector<HTMLButtonElement>('[role="tab"][id$="-loading-tab"]')?.click();
  select.onchange = () => {
    if (select.value !== "disconnected") loading = loadingFixture(select.value as LoadingScenario);
    refresh();
  };
  const advance = document.createElement("button");
  advance.type = "button";
  advance.className =
    "focus-ring mt-3 block rounded-md border border-jank-control px-3 py-2 text-label-13";
  advance.textContent = "Advance host snapshot";
  advance.onclick = () => {
    fixture.advance(1);
    if (loading.current?.status === "loading")
      loading = {
        ...loading,
        current: { ...loading.current, elapsedMs: (loading.current.elapsedMs ?? 0) + 100 },
      };
    refresh();
  };
  section.append(advance);
  cleanup.push(panel.destroy);
}
import.meta.hot?.dispose(() => {
  disposed = true;
  closeViewer();
  for (const destroy of cleanup) destroy();
});
