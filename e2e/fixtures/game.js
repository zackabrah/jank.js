// A small host game for the panel's e2e tests and board screenshots. Its CPU work is
// real (timed busy work inside named scopes) and its load stages are real waits.
// The GPU source is scripted, and labels itself "fixture" so no reader mistakes it.
import {
  createDiagnostics,
  createPerformanceTray,
  createPreparationProfiler,
} from "./index.js";

const params = new URLSearchParams(location.search);

const canvas = document.querySelector("canvas");

const context = canvas.getContext("2d");

const monitor = createDiagnostics({
  application: { name: "jank.js fixture", version: "0.1.0" },
});

const spin = (ms) => {
  const end = performance.now() + ms;

  while (performance.now() < end);
};

const counters = {
  objects: 1204,
  drawCalls: 312,
  triangles: 1_920_000,
  geometries: 96,
  textures: 48,
  pending: 3,
};

const physics = monitor.register("physics", "physics");

const animation = monitor.register("animation", "animation");

const scene = monitor.register("scene", "scene update", () => ({
  objects: counters.objects,
  pending: counters.pending,
}));

const render = monitor.register("render", "render submit", () => ({
  drawCalls: counters.drawCalls,
  triangles: counters.triangles,
  geometries: counters.geometries,
  textures: counters.textures,
}));

let gpuEnabled = true,
  gpuSample = null,
  rendererFrame = 0;

const frameIds = [];

const gpu = {
  label: "fixture",
  read() {
    if (!gpuEnabled)
      return {
        available: true,
        enabled: false,
        status: "disabled",
        currentFrame: rendererFrame,
        sampleFrame: null,
        sampleAgeFrames: null,
        gpuMilliseconds: null,
        passes: [],
        droppedFrames: 0,
        truncatedPasses: 0,
        error: null,
      };

    return gpuSample;
  },
  setEnabled(enabled) {
    gpuEnabled = enabled;
  },
};

const loading = createPreparationProfiler({
  stages: [
    "fetch assets",
    "decode textures",
    "compile shaders",
    "upload to gpu",
    "build scene",
  ],
});

const tray = createPerformanceTray({
  shell: document.body,
  monitor,
  gpu,
  preparation: {
    read: () => loading.snapshot(),
    history: () => loading.history(),
  },
  viewerUrl: params.get("viewer") ?? "/viewer/",
  ...(params.get("mode") ? { mode: params.get("mode") } : {}),
});

let extra = 0;

const spikeFrames = [];

function frame(at) {
  const id = monitor.beginFrame(at);

  frameIds.push(id);

  if (frameIds.length > 8) frameIds.shift();

  rendererFrame++;

  const start = performance.now();

  let token = physics.begin();

  spin(1.4);

  physics.end(token);

  token = animation.begin();

  spin(0.5);

  animation.end(token);

  token = scene.begin();

  if (extra) spikeFrames.push(id);

  spin(1 + extra);

  extra = 0;

  scene.end(token);

  const update = performance.now() - start,
    renderStart = performance.now();

  token = render.begin();

  draw(at);

  spin(1.2);

  render.end(token);

  monitor.endFrame(update, performance.now() - renderStart);

  // Every tenth frame, a pass sample for the frame four frames back.
  if (rendererFrame % 10 === 0 && frameIds.length > 4) {
    const wobble = (rendererFrame % 7) / 20;

    gpuSample = {
      diagnosticFrame: frameIds.at(-5),
      available: true,
      enabled: true,
      status: "ready",
      currentFrame: rendererFrame,
      sampleFrame: rendererFrame - 4,
      sampleAgeFrames: 4,
      gpuMilliseconds: null,
      passes: [
        { label: "shadow", milliseconds: 1.8 + wobble },
        { label: "opaque", milliseconds: 4.1 + wobble },
        { label: "post", milliseconds: 1.1 },
      ],
      droppedFrames: 0,
      truncatedPasses: 0,
      error: null,
    };
  }

  tray.refresh(at);

  requestAnimationFrame(frame);
}

function draw(at) {
  const { width, height } = canvas;

  context.fillStyle = "#06070f";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#1b2c44";

  for (let i = 0; i < 160; i++) {
    const x = (i * 97 + at * 0.02 * ((i % 5) + 1)) % width;

    const y = (i * 53) % height;

    context.fillRect(x, y, 2, 2);
  }

  context.fillStyle = "#ffffff";
  context.font = "800 20px system-ui, sans-serif";
  context.fillText(`WAVE ${counters.objects > 1300 ? 4 : 3}`, 28, 44);

  for (let i = 0; i < 4; i++) {
    context.fillStyle = i < 3 ? "#ffffff" : "#ffffff4d";
    context.fillRect(28 + i * 22, 54, 18, 6);
  }
}

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

addEventListener("resize", resize);

resize();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function session(kind, scale, hits, misses) {
  loading.start({
    label: kind === "fresh-context" ? "cold start" : "restart",
    kind,
  });

  const run = loading.capture();

  for (let i = 0; i < hits; i++) run.cache("fetch assets", "hit");

  for (let i = 0; i < misses; i++) run.cache("fetch assets", "miss");

  const fetched = run.measure("fetch assets", () => wait(120 * scale));

  await wait(50 * scale);

  const decoded = run.measure("decode textures", () => wait(130 * scale));

  await fetched;

  const compiled = run.measure("compile shaders", () => wait(130 * scale));

  await decoded;

  const uploaded = run.measure("upload to gpu", () => wait(60 * scale));

  await compiled;

  await run.measure("build scene", () => wait(50 * scale));

  await uploaded;

  loading.finish("ready");
}

window.fixture = {
  monitor,
  tray,
  /** IDs of the frames the spikes made heavy, so tests can tell them from stalls. */
  spikeFrames,
  /** Real work: a heavy scene update on the next frame, with the events around it. */
  spike(ms = 40) {
    monitor.event("wave 3");
    monitor.event("spawn ×184");

    counters.objects += 184;

    extra = ms;
  },
  event(label) {
    monitor.event(label);
  },
  // Sessions run one after another, as a player would restart.
  loaded: session("fresh-context", 2, 30, 30)
    .then(() => session("repeat-session", 1, 212, 14))
    .then(() => session("repeat-session", 1, 212, 14))
    .then(() => session("repeat-session", 1, 212, 14)),
};

requestAnimationFrame(frame);
