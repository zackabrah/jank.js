import "./gpu.css";
import { createCaptureController } from "../src/capture/controller.ts";
import { captureFixture } from "../src/capture/fixtures.ts";
import { createRuleCaptureSource } from "../src/capture/rule-source.ts";
import { gpuFixture } from "../src/gpu/fixtures.ts";
import { createGpuHistory } from "../src/gpu/history.ts";
import { type GpuFrame, gpuFrameToLive } from "../src/gpu/model.ts";
import { createWebGl2GpuSource } from "../src/gpu/webgl2.ts";
import { mountDiagnosticsPanel } from "../src/live/diagnostics-adapter.ts";
import { liveFixture } from "../src/live/fixtures.ts";
import { mountLivePanel } from "../src/live/panel.tsx";
import { openRecordingViewer } from "../src/viewer/mount.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("Missing GPU review root");
root.innerHTML =
  '<h1 class="mb-3 text-heading-24">GPU evidence review</h1><p class="mb-6 text-copy-13">Labelled reference data. Capture keeps its original frame window while GPU queries finish. Native adapters are separate host imports; no rendering library is bundled.</p><div class="flex flex-wrap items-start gap-6"></div>';
const grid = root.querySelector("div");
if (!grid) throw new Error("Missing review grid");
const cleanup: (() => void)[] = [];
let closeViewer = () => {};
const button = (parent: HTMLElement, label: string, action: () => void) => {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "mt-2 mr-2 rounded-md border border-jank-control px-3 py-2 text-label-13";
  control.textContent = label;
  control.onclick = action;
  parent.append(control);
};
for (const light of [false, true]) {
  const section = document.createElement("section");
  section.className = "w-90";
  const heading = document.createElement("h2");
  heading.className = "mb-3 text-heading-16";
  heading.textContent = `GPU capture · ${light ? "light" : "dark"}`;
  section.append(heading);
  grid.append(section);
  const fixture = captureFixture(12);
  const history = createGpuHistory();
  let latest: GpuFrame | null = null;
  const source = createRuleCaptureSource({
    ...fixture.source,
    gpuCoverage: history.coverage,
    gpuPool: () => ({ free: 15557, ...(!light ? { total: 16384 } : {}), unit: "passes" }),
    finalizeGpu: history.finalize,
  });
  const controller = createCaptureController(source);
  const panel = mountDiagnosticsPanel(
    section,
    { ...source, measureRefresh: (work) => work() },
    () =>
      latest
        ? gpuFrameToLive(latest, source.snapshot(false).frames.at(-1)?.id ?? latest.frameId)
        : null,
    {
      controller,
      onOpen: (capture) => {
        closeViewer();
        closeViewer = openRecordingViewer(document, capture);
      },
    },
  );
  if (light) section.lastElementChild?.classList.add("light-theme");
  let at = 0;
  const refresh = () => {
    at += 250;
    panel.refresh(at);
  };
  for (const frame of source.snapshot().frames) history.record(gpuFixture(frame.id));
  refresh();
  section
    .querySelector("div")
    ?.shadowRoot?.querySelector<HTMLButtonElement>('[role="tab"][id$="-capture-tab"]')
    ?.click();
  button(section, "Advance pending GPU frame", () => {
    fixture.advance(1, 16);
    const id = source.snapshot().frames.at(-1)?.id;
    if (id === undefined) return;
    latest = gpuFixture(id, "pending");
    history.record(latest);
    refresh();
  });
  button(section, "Resolve GPU queries", () => {
    for (const frame of history.read(source.snapshot().frames.map((f) => f.id))) {
      latest = gpuFixture(frame.frameId);
      history.record(latest);
    }
    refresh();
  });
  cleanup.push(() => {
    controller.discard();
    panel.destroy();
  });
}
for (const light of [false, true])
  for (const [name, state] of [
    ["Complete · measured zero", "timed"],
    ["Partial · rejected", "rejected"],
    ["Partial · omitted", "omitted"],
    ["Unknown inventory", "timed"],
    ["Complete · none submitted", "timed"],
    ["Partial · mixed + overflow", "timed"],
  ] as const) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = `${name} · ${light ? "light" : "dark"}`;
    heading.className = "mb-3 text-heading-16";
    section.append(heading);
    grid.append(section);
    const frame = gpuFixture(1246, state);
    if (name === "Unknown inventory") frame.inventory = "unknown";
    if (name === "Complete · none submitted") frame.invocations = [];
    if (name === "Partial · mixed + overflow") {
      frame.omitted = 2;
      frame.invocations = (["timed", "pending", "rejected", "omitted"] as const).flatMap(
        (state, index) =>
          gpuFixture(frame.frameId, state).invocations.map((pass) => ({
            ...pass,
            id: `pass:${index}`,
            label: `Pass ${index + 1}`,
            kind: index % 2 ? ("compute" as const) : ("render" as const),
          })),
      );
    }
    const panel = mountLivePanel(section);
    panel.update({ ...liveFixture(), gpu: gpuFrameToLive(frame, 1248) });
    if (light) section.lastElementChild?.classList.add("light-theme");
    cleanup.push(panel.destroy);
  }
const native = document.createElement("section");
root.append(native);
const result = document.createElement("p");
result.id = "native-result";
result.className = "mt-3 text-copy-13";
result.textContent =
  "Native WebGL2 smoke check has not run. This checks API operation, not hardware accuracy.";
native.append(result);
button(native, "Run native WebGL2 smoke check", () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    result.textContent = "WebGL2 unavailable";
    return;
  }
  let frame = 0,
    timed = false;
  const gpu = createWebGl2GpuSource(gl, (record) => {
    const duration = record.invocations[0]?.milliseconds;
    if (duration === null || duration === undefined) return;
    timed = true;
    result.textContent = `WebGL2 timed frame ${record.frameId}: ${duration.toFixed(1)} ms · GPU resolution unknown`;
  });
  if (!gpu.supported) {
    result.textContent = "WebGL2 timer extension unavailable";
    gpu.dispose();
    return;
  }
  let request = 0;
  const draw = () => {
    gpu.beginPass("Clear");
    gl.clearColor(0.1, 0.2, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gpu.endPass();
    gpu.captureFrame(++frame, "complete");
    if (!timed && frame < 120) request = requestAnimationFrame(draw);
    else {
      if (!timed) result.textContent = "WebGL2 query did not resolve within 120 frames";
      gpu.dispose();
    }
  };
  request = requestAnimationFrame(draw);
  cleanup.push(() => {
    cancelAnimationFrame(request);
    gpu.dispose();
  });
});
import.meta.hot?.dispose(() => {
  closeViewer();
  for (const destroy of cleanup) destroy();
  root.replaceChildren();
});
