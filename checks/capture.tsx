import "./capture.css";
import { createCaptureController } from "../src/capture/controller.ts";
import { captureFixture } from "../src/capture/fixtures.ts";
import type { ReadInstrumentation } from "../src/capture/instrumentation-model.ts";
import { createRuleCaptureSource } from "../src/capture/rule-source.ts";
import { mountDiagnosticsPanel } from "../src/live/diagnostics-adapter.ts";

const root = document.getElementById("app");
if (!root) throw new Error("Missing review root");
root.innerHTML =
  '<h1 class="mb-3 text-heading-24">Capture review</h1><p class="mb-6 text-copy-13">Reference host with a 12-frame capacity. Auto defaults to 5 frames before and 6 after a spike, with a 5-second cooldown. Edit rule to try sustained or episode capture; inject slow frames and advance quiet frames to test recovery. No real measurements.</p><div class="flex flex-wrap items-start gap-6"></div><p id="result" class="mt-6 text-copy-13"></p>';
const grid = root.querySelector("div");
if (!grid) throw new Error("Missing review grid");
const cleanup: (() => void)[] = [];
let closeViewer = () => {};
let disposed = false;
for (const [name, light, recorded, saved] of [
  ["Idle · dark", false, 0, 0],
  ["Recording · dark", false, 4, 0],
  ["Near capacity · light", true, 11, 0],
  ["Saved · dark", false, 0, 3],
  ["Retention limit · light", true, 0, 10],
  ["Armed · light", true, 0, 0],
  ["Capturing · dark", false, 0, 0],
  ["Cooldown · light", true, 0, 0],
] as const) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.className = "mb-3 text-heading-16";
  heading.textContent = name;
  section.append(heading);
  grid.append(section);
  const fixture = captureFixture(12);
  const { advance } = fixture;
  const source = createRuleCaptureSource(fixture.source);
  const controller = createCaptureController(source);
  for (let i = 0; i < saved; i++) {
    controller.start();
    advance(6);
    controller.stopAndSave();
  }
  if (recorded) {
    controller.start();
    advance(recorded);
  }
  if (name.startsWith("Armed") || name.startsWith("Capturing") || name.startsWith("Cooldown")) {
    controller.toggleAuto();
    if (!name.startsWith("Armed")) {
      advance(1, 48);
      controller.refresh(source.snapshot());
      for (let i = 0; i < (name.startsWith("Cooldown") ? 6 : 2); i++) {
        advance(1, 16);
        controller.refresh(source.snapshot());
      }
    }
  }
  const monitor = { ...source, measureRefresh: <T,>(work: () => T) => work() };
  let gpuTiming = true;
  let traceEvents = false;
  let rejectInstrumentation = false;
  const instrumentation: ReadInstrumentation = () => ({
    gpuTiming: {
      enabled: gpuTiming,
      setEnabled(value) {
        if (rejectInstrumentation) throw new Error("Reference host rejected GPU timing change.");
        gpuTiming = value;
      },
    },
    traceEvents: {
      enabled: traceEvents,
      setEnabled(value) {
        if (rejectInstrumentation) throw new Error("Reference host rejected trace events change.");
        traceEvents = value;
      },
    },
  });
  const panel = mountDiagnosticsPanel(
    section,
    monitor,
    undefined,
    {
      controller,
      onOpen: async (capture) => {
        const { openRecordingViewer } = await import("../src/viewer/mount.tsx");
        if (disposed) return;
        closeViewer();
        closeViewer = openRecordingViewer(document, capture);
      },
    },
    name === "Idle · dark" ? instrumentation : undefined,
  );
  let at = 0;
  panel.refresh(at);
  const host = section.lastElementChild;
  if (light) host?.classList.add("light-theme");
  host?.shadowRoot?.querySelector<HTMLButtonElement>('[role="tab"][id$="-capture-tab"]')?.click();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mt-3 rounded-md border border-jank-control px-3 py-2 text-label-13";
  button.textContent = "Advance 4 reference frames";
  button.onclick = () => {
    for (let i = 0; i < 4; i++) {
      advance();
      at += 16;
      panel.refresh(at);
    }
    at += 250;
    panel.refresh(at);
  };
  section.append(button);
  if (name === "Idle · dark") {
    for (const [label, action] of [
      [
        "Toggle host GPU timing",
        () => {
          gpuTiming = !gpuTiming;
        },
      ],
      [
        "Reject instrumentation changes",
        () => {
          rejectInstrumentation = true;
        },
      ],
    ] as const) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "mt-2 mr-2 rounded-md border border-jank-control px-3 py-2 text-label-13";
      control.textContent = label;
      control.onclick = () => {
        action();
        panel.refresh(at, true);
      };
      section.append(control);
    }
  }
  for (const [label, count, interval] of [
    ["Inject 48 ms spike", 1, 48],
    ["Inject 6 slow frames", 6, 48],
    ["Advance 8 quiet frames", 8, 16],
    ["Advance 5 seconds", 300, 1000 / 60],
  ] as const) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "mt-2 mr-2 rounded-md border border-jank-control px-3 py-2 text-label-13";
    action.textContent = label;
    action.onclick = () => {
      for (let i = 0; i < count; i++) {
        advance(1, interval);
        at += interval;
        panel.refresh(at);
      }
      at += 250;
      panel.refresh(at);
    };
    section.append(action);
  }
  cleanup.push(panel.destroy);
}
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const problems: string[] = [];
    for (const section of grid.children) {
      const panel = section
        .querySelector("div")
        ?.shadowRoot?.querySelector<HTMLElement>('section[aria-label="Live performance panel"]');
      if (panel?.getBoundingClientRect().width !== 360) problems.push("Panel width");
      if (panel && panel.scrollWidth > panel.clientWidth) problems.push("Panel overflow");
    }
    const result = document.getElementById("result");
    if (result)
      result.textContent = problems.length
        ? `FAIL: ${problems.join(", ")}`
        : "PASS: eight capture states at 360px without horizontal overflow.";
  }),
);
import.meta.hot?.dispose(() => {
  disposed = true;
  closeViewer();
  for (const destroy of cleanup) destroy();
  root.replaceChildren();
});
if (import.meta.env.DEV) void import("../devtools/index.tsx");
