import { createDiagnosticPreview } from "../ui-library/diagnostic-preview.ts";

const path = "/reference/index.js";
const { createDiagnostics, createPerformanceTray, createPreparationProfiler } = await import(
  /* @vite-ignore */ path
);
const sample = await (await fetch("/samples/rewrite.json")).json();
const selected = new URLSearchParams(location.search).get("mode") ?? "full";
const mode = selected === "loading" || selected === "diagnostics" ? "full" : selected;
localStorage.setItem("jank.js:panel-mode", mode);
let now = 0;
const monitor = createDiagnostics({
  now: () => now,
  costClock: () => 0,
  application: { name: "Matched synthetic scene" },
});
monitor.setExpanded(true);
const channels = new Map(
  sample.channels.map((channel) => [channel.id, monitor.register(channel.id, channel.label)]),
);
let loadingTimeMs = 0;
const preparation = createPreparationProfiler({
  now: () => loadingTimeMs,
  stages: ["fetch", "decode"],
});
for (const kind of ["fresh-context", "repeat-session"]) {
  preparation.start({ label: "Synthetic scene", kind });
  const fetch = preparation.begin("fetch");
  preparation.cache("fetch", kind === "fresh-context" ? "miss" : "hit");
  if (kind === "fresh-context") {
    preparation.bytes("fetch", 2048);
    loadingTimeMs += 100;
    const shared = preparation.begin("fetch");
    preparation.cache("fetch", "inflight");
    loadingTimeMs += 200;
    fetch();
    loadingTimeMs += 200;
    shared();
  } else {
    loadingTimeMs += 50;
    fetch();
  }
  const decode = preparation.begin("decode");
  loadingTimeMs += kind === "fresh-context" ? 100 : 50;
  decode();
  preparation.finish("ready");
}
const diagnostics = createDiagnosticPreview();
const culling = {
  ...diagnostics.visibility,
  read: () => {
    const source = diagnostics.visibility.read();
    const main = source.views[0];
    return {
      ...source,
      main,
      shadow: { tested: 0, visible: 0, culled: 0 },
      reflection: { tested: 0, visible: 0, culled: 0 },
      bounds: [],
      boundsOmitted: 0,
      viewProjection: null,
      instances: {
        ...source.instances,
        views: source.instances.views.map((view) => ({ ...view, view: view.name })),
      },
    };
  },
};
const tray = createPerformanceTray({
  shell: document.body,
  monitor,
  ...(selected === "diagnostics" ? { culling, temporal: diagnostics.temporal } : {}),
  mode,
  corner: "top-left",
  preparation: { read: () => preparation.snapshot(), history: () => preparation.history() },
});
for (const frame of sample.frames) {
  now = frame.startedAtMs;
  monitor.beginFrame(now);
  for (const event of sample.events.filter((event) => event.atMs === now)) {
    monitor.event(event.label);
  }
  for (const scope of frame.scopes) {
    const channel = channels.get(scope.channelId);
    now = scope.startedAtMs;
    const token = channel.begin();
    now = scope.endedAtMs;
    channel.end(token);
  }
  monitor.endFrame(frame.cpu.updateMs, frame.cpu.renderMs);
}
now = sample.frames.at(-1).endedAtMs;
monitor.beginFrame(now);
tray.refresh(now);
if (selected === "loading") {
  document.querySelector('[data-tab="loading"]')?.click();
  tray.refresh(now + 1000);
}
window.addEventListener(
  "pagehide",
  () => {
    tray.dispose();
    monitor.dispose();
  },
  { once: true },
);
