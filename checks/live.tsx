import "./live.css";
import { liveFixture } from "../src/live/fixtures.ts";
import { mountLivePanel } from "../src/live/panel.tsx";
import type { PanelMode } from "../src/live/state-strip.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("Missing review root");
root.innerHTML =
  '<h1 class="mb-3 text-heading-24">LIVE panel review</h1><p class="mb-6 text-copy-13">Reference data only. Full, mini and line share one window. Try modes, Freeze/Resume, budget selection and panel-scoped M / F shortcuts. Capture badges are sample host states. <a href="/?demo" class="focus-ring underline">Open the animated CPU/GPU demo</a>.</p><div class="flex flex-wrap items-start gap-6"></div><p id="result" class="mt-6 text-copy-13"></p>';
const grid = root.querySelector("div");
if (!grid) throw new Error("Missing review grid");
const panels: ReturnType<typeof mountLivePanel>[] = [];
const cases: {
  name: string;
  mode: PanelMode;
  light?: boolean;
  empty?: boolean;
  missing?: boolean;
  frozen?: boolean;
  capture?: "armed" | "recording" | "capturing" | "cooldown";
}[] = [
  { name: "Full · dark", mode: "full" },
  { name: "Full · light", mode: "full", light: true },
  { name: "Compute not observed", mode: "full", missing: true },
  { name: "Waiting", mode: "full", empty: true },
  { name: "Mini · dark", mode: "mini" },
  { name: "Mini · light", mode: "mini", light: true },
  { name: "Mini · frozen + capturing", mode: "mini", frozen: true, capture: "capturing" },
  { name: "Line · live", mode: "line" },
  { name: "Line · armed", mode: "line", capture: "armed" },
  { name: "Line · recording", mode: "line", capture: "recording" },
  { name: "Line · frozen + recording", mode: "line", frozen: true, capture: "recording" },
  { name: "Line · frozen + capturing", mode: "line", frozen: true, capture: "capturing" },
  { name: "Line · light + cooldown", mode: "line", light: true, frozen: true, capture: "cooldown" },
  { name: "Line · waiting", mode: "line", empty: true },
];
for (const example of cases) {
  const container = document.createElement("section");
  const heading = document.createElement("h2");
  heading.className = "mb-3 text-heading-16";
  heading.textContent = example.name;
  container.append(heading);
  grid.append(container);
  const snapshot = liveFixture(example.empty, example.missing);
  snapshot.diagnostics.recording =
    example.capture === "recording" || example.capture === "capturing";
  snapshot.diagnostics.capture = {
    mode: example.capture === "recording" ? "manual" : "automatic",
    state: example.capture === "capturing" ? "recording" : (example.capture ?? "idle"),
  };
  if (example.name.startsWith("Full ·")) {
    const advance = document.createElement("button");
    advance.type = "button";
    advance.className = "focus-ring mb-3 block text-copy-13 underline";
    advance.textContent = "Advance reference events";
    advance.addEventListener("click", () => {
      snapshot.diagnostics.frames = snapshot.diagnostics.frames.map((frame) => ({
        ...frame,
        id: frame.id + 240,
        at: frame.at + 4000,
        scopes: frame.scopes.map((scope) => ({
          ...scope,
          start: scope.start + 4000,
          end: scope.end + 4000,
        })),
      }));
      const latest = snapshot.diagnostics.frames.at(-1);
      if (latest)
        snapshot.diagnostics.events = [
          ...(snapshot.diagnostics.events ?? []).slice(-199),
          {
            at: latest.at - 1,
            label: "Reference advanced",
            detail: "Older events left the graph window.",
          },
        ];
      panel.update(snapshot);
    });
    container.append(advance);
    const resetHistory = document.createElement("button");
    resetHistory.type = "button";
    resetHistory.className = "focus-ring mb-3 block text-copy-13 underline";
    resetHistory.textContent = "Invalidate reference history";
    resetHistory.addEventListener("click", () => {
      snapshot.diagnostics.systems = snapshot.diagnostics.systems.map((system) =>
        system.id === "render"
          ? {
              ...system,
              values: {
                ...system.values,
                temporalHistoryValid: false,
                temporalHistoryAgeFrames: 0,
                temporalHistoryResetReason: "Camera cut (reference)",
              },
            }
          : system,
      );
      panel.update(snapshot);
    });
    container.append(resetHistory);
  }
  const panel = mountLivePanel(container, {
    initialMode: example.mode,
    onBudgetChange: (milliseconds) => {
      snapshot.diagnostics.budget.frameMs = milliseconds;
      panel.update(snapshot);
    },
  });
  panel.update(snapshot);
  if (example.light) container.lastElementChild?.classList.add("light-theme");
  if (example.frozen)
    container.lastElementChild?.shadowRoot
      ?.querySelector("section")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
  panels.push(panel);
}
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const problems: string[] = [];
    for (const container of grid.children) {
      const shadow = container.lastElementChild?.shadowRoot;
      const panel = shadow?.querySelector<HTMLElement>(
        'section[aria-label="Live performance panel"]',
      );
      const mode = panel?.getAttribute("data-mode");
      if (
        !panel ||
        Math.abs(panel.getBoundingClientRect().width - (mode === "mini" ? 240 : 360)) > 0.5
      )
        problems.push("Panel width");
      if (mode === "line" && panel?.getBoundingClientRect().height !== 28)
        problems.push("Line height");
      if (panel && panel.scrollWidth > panel.clientWidth) problems.push("Horizontal overflow");
      if (shadow?.querySelector('svg path[d*="NaN"], svg path[d*="Infinity"]'))
        problems.push("Invalid chart");
      const strip = shadow?.querySelector<HTMLElement>(
        `[data-mode-header="${mode}"] [data-state-strip]`,
      );
      for (const badge of strip?.querySelectorAll('[data-state-badges] > [role="status"]') ?? []) {
        if (
          strip &&
          badge.getBoundingClientRect().right > strip.getBoundingClientRect().right + 0.5
        )
          problems.push(`Status overflow: ${container.firstElementChild?.textContent}`);
      }
      if (mode === "line")
        for (const label of ["p95", "fps"]) {
          const metric = shadow?.querySelector(
            `[data-mode-header="line"] [data-metric="${label}"]`,
          );
          if (!metric?.getBoundingClientRect().width) problems.push(`Missing ${label}`);
        }
    }
    const result = document.getElementById("result");
    if (result)
      result.textContent = problems.length
        ? `FAIL: ${problems.join(", ")}`
        : `PASS: ${cases.length} panels; full/mini widths, 28px line height, state-strip fit, p95/FPS visibility and finite charts.`;
  }),
);
import.meta.hot?.dispose(() => {
  for (const panel of panels) panel.destroy();
  root.replaceChildren();
});
if (import.meta.env.DEV) void import("../devtools/index.tsx");
