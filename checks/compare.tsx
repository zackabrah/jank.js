import "./compare.css";
import { createCaptureController } from "../src/capture/controller.ts";
import { captureFixture } from "../src/capture/fixtures.ts";
import { createComparisonController } from "../src/compare/controller.ts";
import { type ComparisonScenario, comparisonFixture } from "../src/compare/fixtures.ts";
import { comparisonResults } from "../src/compare/results.ts";
import { ComparisonResultsView } from "../src/compare/results-view.tsx";
import panelStyles from "../src/live/panel.css?inline";
import { mountLivePanel } from "../src/live/panel.tsx";
import { loadingFixture } from "../src/loading/fixtures.ts";
import { mountShadowView } from "../src/shadow-view.ts";

const root = document.getElementById("app");
if (!root) throw new Error("Missing comparison review root.");
root.innerHTML =
  '<h1 class="mb-3 text-heading-24">A/B runner review</h1><p class="mb-6 max-w-3xl text-copy-13">SIMULATED host data. Advance the host to walk through warm-up, measurement and GPU drain. Review capture guards, concurrent Loading, Stop and partial export. Finish the run to inspect results. Static result cases below cover verdicts, missing data and scope changes; the A/B viewer follows separately.</p><div class="flex flex-wrap items-start gap-6"></div>';
const grid = root.querySelector("div");
if (!grid) throw new Error("Missing comparison review grid.");
const cleanup: (() => void)[] = [];
for (const theme of ["dark", "light"]) {
  const section = document.createElement("section");
  section.setAttribute("aria-label", `Comparison review ${theme}`);
  const title = document.createElement("h2");
  title.textContent = theme;
  title.className = "mb-3 text-heading-16";
  const container = document.createElement("div");
  const controls = document.createElement("div");
  controls.className = "mt-3 flex w-90 flex-wrap gap-2";
  section.append(title, container, controls);
  grid.append(section);
  const fixture = captureFixture(6000);
  const capture = createCaptureController(fixture.source);
  let variant = "A";
  const comparison = createComparisonController({
    capture,
    change: "workload",
    variants: {
      A: { label: "SIMULATED baseline", settings: { workload: "baseline", objects: 64 } },
      B: { label: "SIMULATED candidate", settings: { workload: "candidate", objects: 128 } },
    },
    activate: (next) => {
      variant = next;
    },
    restore: () => {
      variant = "A";
    },
  });
  const panel = mountLivePanel(container, {
    comparison,
    capture: { controller: capture, onOpen: () => {} },
  });
  const refresh = () => {
    const diagnostics = fixture.source.snapshot();
    capture.refresh(diagnostics);
    panel.update({ diagnostics, gpu: null, loading: loadingFixture("loading") });
  };
  const frame = async () => {
    fixture.advance(1, variant === "A" ? 16 : 18);
    comparison.advance();
    await Promise.resolve();
    await Promise.resolve();
    refresh();
  };
  const button = (label: string, action: () => void | Promise<void>) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "focus-ring rounded-md border border-jank-control px-2 py-1 text-label-12";
    node.textContent = label;
    node.onclick = () => {
      void Promise.resolve(action()).catch((error: unknown) => {
        throw error;
      });
    };
    controls.append(node);
  };
  button("Advance one frame", frame);
  button("Finish current trial", async () => {
    const count = comparison.getSnapshot().bundle.trials.length;
    for (
      let i = 0;
      i < 3000 &&
      comparison.getSnapshot().phase !== "idle" &&
      comparison.getSnapshot().bundle.trials.length === count;
      i++
    )
      await frame();
  });
  button("External capture change", () => {
    fixture.source.startRecording();
    comparison.advance();
    refresh();
  });
  refresh();
  if (theme === "light") container.firstElementChild?.classList.add("light-theme");
  container.firstElementChild?.shadowRoot
    ?.querySelector<HTMLButtonElement>('[role="tab"][id$="-compare-tab"]')
    ?.click();
  cleanup.push(() => {
    comparison.destroy();
    panel.destroy();
  });
}
const resultsTitle = document.createElement("h2");
resultsTitle.id = "results";
resultsTitle.textContent = "SIMULATED result references";
resultsTitle.className = "mt-8 mb-3 text-heading-24";
const resultsGrid = document.createElement("div");
resultsGrid.className = "flex flex-wrap items-start gap-6";
root.append(resultsTitle, resultsGrid);
for (const theme of ["dark", "light"]) {
  const section = document.createElement("section");
  section.setAttribute("aria-label", `Comparison results ${theme}`);
  const label = document.createElement("label");
  label.textContent = `Result case · ${theme}`;
  label.className = "mb-2 block text-label-13";
  const select = document.createElement("select");
  select.id = `comparison-result-${theme}`;
  label.htmlFor = select.id;
  select.className =
    "focus-ring mb-3 h-8 rounded-md border border-jank-control bg-jank-surface px-2 text-label-13";
  for (const [value, title] of [
    ["mixed", "Mixed: CPU slower, GPU unchanged, frame inconclusive"],
    ["faster", "B faster"],
    ["same", "No observed difference"],
    ["inconclusive", "Inconclusive CPU and frame"],
    ["gpu-gap", "GPU coverage below threshold"],
    ["scope-shifts", "Opposing scope changes, unchanged totals"],
    ["stopped", "Stopped with a missing trial"],
    ["low-samples", "Too few samples"],
    ["low-window", "Incomplete measurement window"],
  ])
    if (value && title) select.add(new Option(title, value));
  const container = document.createElement("div");
  section.append(label, select, container);
  resultsGrid.append(section);
  const preview = mountShadowView(container, panelStyles);
  const refresh = () =>
    preview.render(
      <>
        <style>{panelStyles}</style>
        <section class="material-menu w-90 font-sans text-copy-13 text-jank-text">
          <div data-compare-scroll class="relative h-144 overflow-y-auto overscroll-contain p-3">
            <ComparisonResultsView
              key={select.value}
              model={comparisonResults(comparisonFixture(select.value as ComparisonScenario))}
              running={false}
            />
          </div>
        </section>
      </>,
    );
  select.onchange = refresh;
  refresh();
  if (theme === "light") container.firstElementChild?.classList.add("light-theme");
  cleanup.push(preview.destroy);
}
import.meta.hot?.dispose(() => {
  for (const dispose of cleanup) dispose();
});
