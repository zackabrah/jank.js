import {
  createLoadingProfiler,
  createPanel,
  createProfiler,
} from "../../packages/jank/src/index.ts";

import { readRecording } from "../../packages/jank/src/recordings/codec.ts";

const sample = readRecording(await (await fetch("/samples/rewrite.json")).json());
const selected = new URLSearchParams(location.search).get("mode");
const mode = selected === "line" || selected === "mini" ? selected : "full";
let nowMs = 0;
const profiler = createProfiler({
  now: () => nowMs,
  application: { name: "Matched synthetic scene" },
});
const release = profiler.requestScopes();
const channels = new Map(
  sample.channels.map((channel) => [channel.id, profiler.createChannel(channel)]),
);
let loadingTimeMs = 0;
const loading = createLoadingProfiler({ now: () => loadingTimeMs });
for (const kind of ["fresh-context", "repeat-session"] as const) {
  const run = loading.beginRun({ label: "Synthetic scene", kind });
  const fetch = run.startStage("fetch");
  fetch.recordCache(kind === "fresh-context" ? "miss" : "hit");
  if (kind === "fresh-context") {
    fetch.addReceivedBytes(2048);
    loadingTimeMs += 100;
    const shared = run.startStage("fetch");
    shared.recordCache("in-flight");
    loadingTimeMs += 200;
    fetch.finish();
    loadingTimeMs += 200;
    shared.finish();
  } else {
    loadingTimeMs += 50;
    fetch.finish();
  }
  const decode = run.startStage("decode");
  loadingTimeMs += kind === "fresh-context" ? 100 : 50;
  decode.finish();
  run.finish("ready");
}
const panel = createPanel({
  container: document.body,
  profiler,
  loading,
  mode,
  corner: "top-left",
});
panel.setMode(mode);
for (const frame of sample.frames) {
  nowMs = frame.startedAtMs;
  profiler.beginFrame(nowMs);
  for (const event of sample.events.filter((event) => event.atMs === nowMs)) {
    profiler.addEvent(event.label);
  }
  for (const scope of frame.scopes) {
    const channel = channels.get(scope.channelId);
    if (!channel) {
      throw new Error("Missing sample channel");
    }
    nowMs = scope.startedAtMs;
    const token = channel.begin();
    nowMs = scope.endedAtMs;
    channel.end(token);
  }
  if (frame.cpu.updateMs !== null && frame.cpu.renderMs !== null) {
    profiler.endFrame({ updateMs: frame.cpu.updateMs, renderMs: frame.cpu.renderMs });
  }
}
nowMs = sample.frames.at(-1)?.endedAtMs ?? 0;
profiler.beginFrame(nowMs);
panel.refresh(nowMs);
if (selected === "loading") {
  document.querySelector<HTMLButtonElement>('[data-tab="loading"]')?.click();
}
window.addEventListener(
  "pagehide",
  () => {
    panel.dispose();
    release();
    profiler.dispose();
    loading.dispose();
  },
  { once: true },
);
