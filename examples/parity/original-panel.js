const path = "/reference/index.js";
const { createDiagnostics, createPerformanceTray } = await import(/* @vite-ignore */ path);
const sample = await (await fetch("/samples/rewrite.json")).json();
const mode = new URLSearchParams(location.search).get("mode") ?? "full";
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
const tray = createPerformanceTray({ shell: document.body, monitor, mode, corner: "top-left" });
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
window.addEventListener(
  "pagehide",
  () => {
    tray.dispose();
    monitor.dispose();
  },
  { once: true },
);
