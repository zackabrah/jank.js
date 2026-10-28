// Accuracy and stress scene. e2e/accuracy.spec.ts drives it; `pnpm stress` opens it with
// labelled controls that add each kind of load by hand. Every frame does real work: a particle
// simulation and a Canvas 2D draw of every particle, plus an occasional large sort. Nothing
// is a timed busy-wait, so no one knows each frame's cost in advance. jank.js, stats.js and
// stats-gl all time the same work, and Chrome's trace times it independently; the test
// compares them.
import { createDiagnostics, createPerformanceTray } from "./index.js";

import { createWebGl2GpuSource } from "./adapters/webgl2.js";

import StatsGl from "./stats-gl/main.js";

const canvas = document.querySelector("canvas");

const context = canvas.getContext("2d");

const maxParticles = 400_000;

const positions = new Float32Array(maxParticles * 2);

const velocities = new Float32Array(maxParticles * 2);

let spikeData = new Float64Array(0);

for (let i = 0; i < maxParticles * 2; i++) {
  positions[i] = Math.random();

  velocities[i] = (Math.random() - 0.5) * 0.01;
}

/** Moves particles toward the centre with damping and bounces them off the edges. */
function simulate(count) {
  for (let i = 0; i < count * 2; i += 2) {
    const dx = 0.5 - positions[i],
      dy = 0.5 - positions[i + 1];

    const pull = 0.0005 / (Math.sqrt(dx * dx + dy * dy) + 0.05);

    velocities[i] = (velocities[i] + dx * pull) * 0.999;
    velocities[i + 1] = (velocities[i + 1] + dy * pull) * 0.999;

    positions[i] += velocities[i];
    positions[i + 1] += velocities[i + 1];

    if (positions[i] < 0 || positions[i] > 1) velocities[i] *= -1;

    if (positions[i + 1] < 0 || positions[i + 1] > 1) velocities[i + 1] *= -1;
  }
}

/** Clears the canvas and draws one small square per particle. */
function draw(count) {
  const { width, height } = canvas;

  context.fillStyle = "#06070f";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#7dd3fc";

  for (let i = 0; i < count * 2; i += 2)
    context.fillRect(positions[i] * width, positions[i + 1] * height, 2, 2);
}

/** Refills and sorts a large array: real, uninterruptible work for a spike frame. */
function spike() {
  for (let i = 0; i < spikeData.length; i++) spikeData[i] = Math.random();

  spikeData.sort();
}

/** Median of a few timed runs of some work, in milliseconds. */
function timed(work, runs = 5) {
  const times = [];

  for (let run = 0; run < runs; run++) {
    const start = performance.now();

    work();

    times.push(performance.now() - start);
  }

  return times.toSorted((a, b) => a - b)[runs >> 1];
}

/**
 * Sizes the work for this machine, so light frames fit the budget, heavy frames don't, and
 * spikes are long animation frames everywhere. The work itself stays real.
 */
function calibrate() {
  const sample = 20_000;

  const perParticle =
    timed(() => {
      simulate(sample);

      draw(sample);
    }) / sample;

  const sortSample = 200_000;

  spikeData = new Float64Array(sortSample);

  const perElement = timed(spike, 3) / sortSample;

  spikeData = new Float64Array(
    Math.min(8_000_000, Math.round(90 / perElement)),
  );

  return {
    perParticle,
    light: Math.min(maxParticles, Math.round(4 / perParticle)),
    heavy: Math.min(maxParticles, Math.round(30 / perParticle)),
  };
}

/** Matches the canvas to its CSS size. */
function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

resize();

addEventListener("resize", resize);

const monitor = createDiagnostics({
  application: { name: "jank.js accuracy scene", version: "0.1.0" },
});

const simulation = monitor.register("simulation", "simulation"),
  drawing = monitor.register("draw", "canvas draw"),
  sorting = monitor.register("spike", "spike sort"),
  submitting = monitor.register("render", "render submit");

// GPU layer: a full-screen WebGL2 shader whose per-pixel work a control sets, timed by
// jank.js/adapters/webgl2 exactly as a host would wire it. Freshly generated shaders,
// compiled on demand, cause real compile hitches.
const gpuCanvas = document.querySelector("#gpu-canvas");

const gl = gpuCanvas.getContext("webgl2", { antialias: false });

const vertexSource = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

/** A fragment shader looping `iterations` times per pixel, with optional extra statements. */
const fragmentSource = (extra = "") => `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform int iterations;
uniform float time;
void main() {
  vec3 v = vec3(uv, time);
  for (int i = 0; i < 4096; i++) {
    if (i >= iterations) break;
    v = sin(v.yzx * 1.7 + v * 0.3);
  }
  ${extra}
  color = vec4(abs(v) * 0.6, 1.0);
}`;

/** Compiles and links a program; reading LINK_STATUS waits for the compile, as a first draw would. */
function compile(fragment) {
  const linked = gl.createProgram();

  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragment],
  ]) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(linked, shader);
    gl.deleteShader(shader);
  }

  gl.bindAttribLocation(linked, 0, "corner");
  gl.linkProgram(linked);

  if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(linked) ?? "Shader link failed");

  return linked;
}

/** A shader no cache has seen: hundreds of statements with random constants. */
const freshShader = () =>
  fragmentSource(
    Array.from(
      { length: 300 },
      (_, i) => `v = sin(v * ${(1 + Math.random()).toFixed(5)} + ${i}.0);`,
    ).join("\n"),
  );

const loadProgram = gl ? compile(fragmentSource()) : null;

if (gl) {
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  // One triangle that covers the whole screen.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

// Each sample goes to the monitor, which links it to its frame, and to the prototype verdict.
const gpuSamples = [];

const gpu = gl
  ? createWebGl2GpuSource(gl, {
      onSample(profile) {
        monitor.observeGpu(profile);

        gpuSamples.push(
          profile.passes.reduce(
            (sum, pass) => sum + (pass.milliseconds ?? 0),
            0,
          ),
        );

        if (gpuSamples.length > 600) gpuSamples.shift();
      },
    })
  : undefined;

/** Draws the full-screen shader as one timed pass. */
function drawGpu(at) {
  if (gpuCanvas.width !== innerWidth || gpuCanvas.height !== innerHeight) {
    gpuCanvas.width = innerWidth;
    gpuCanvas.height = innerHeight;

    gl.viewport(0, 0, innerWidth, innerHeight);
  }

  gpu.beginPass("fullscreen shader");

  gl.useProgram(loadProgram);
  gl.uniform1i(
    gl.getUniformLocation(loadProgram, "iterations"),
    stress.gpuIterations,
  );
  gl.uniform1f(gl.getUniformLocation(loadProgram, "time"), at / 1000);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gpu.endPass();
}

/**
 * Compiles a never-seen shader and draws with it once, as a new material's first frame does.
 * The draw covers one pixel, so the hitch is the compile, not the shader's GPU work.
 */
function compileFreshShader() {
  const fresh = compile(freshShader());

  gl.viewport(0, 0, 1, 1);
  gl.useProgram(fresh);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.viewport(0, 0, gpuCanvas.width, gpuCanvas.height);
  gl.deleteProgram(fresh);
}

// Opens expanded: per-system detail is collected while the panel is expanded, recording or
// armed, and the prototype verdict needs it to say where time goes.
const tray = createPerformanceTray({
  shell: document.body,
  monitor,
  mode: "full",
  gpu,
});

// stats.js creates its panels inside the constructor through Stats.Panel; wrapping it first
// records every value the panels display, which is what a stats.js user reads.
const statsJsReadings = { FPS: [], MS: [] };

const BasePanel = window.Stats.Panel;

window.Stats.Panel = function (name, foreground, background) {
  const panel = BasePanel(name, foreground, background);

  const update = panel.update;

  panel.update = (value, maxValue) => {
    statsJsReadings[name]?.push({ at: performance.now(), value });

    update(value, maxValue);
  };

  return panel;
};

const statsJs = new window.Stats();

const statsGl = new StatsGl({ trackGPU: false });

statsJs.dom.style.cssText = "position:fixed;left:0;bottom:0";

// stats-gl places its canvases absolutely inside a zero-size box, so lift the box by their height.
statsGl.dom.style.cssText = "position:fixed;left:90px;bottom:48px";

document.body.append(statsJs.dom, statsGl.dom);

const sizes = calibrate();

// Interactive load, set by the controls. Test runs ignore it; their plan sets every frame.
const stress = {
  codeMs: 4,
  spikeEveryMs: 0,
  garbage: 0,
  layouts: 0,
  gpuIterations: 0,
  shaderEveryMs: 0,
};

let nextSpike = 0,
  nextShader = 0,
  retained = [];

const layoutBox = document.querySelector("#layout-box");

/** Allocates objects every frame and keeps the last ten frames' worth, so the collector works. */
function makeGarbage(count) {
  const batch = Array.from({ length: count }, (_, i) => ({
    i,
    x: i * 0.5,
    y: i,
  }));

  retained.push(batch);

  if (retained.length > 10) retained.shift();
}

// A block with many children, so each forced layout has real work to redo.
for (let i = 0; i < 1500; i++) layoutBox.append(document.createElement("span"));

/** Writes a style, then reads layout, forcing the browser to lay the block out each time. */
function forceLayouts(count) {
  for (let i = 0; i < count; i++) {
    layoutBox.style.width = `${200 + (i % 100)}px`;

    void layoutBox.offsetWidth;
  }
}

let plan = [],
  log = [],
  stopAfter = -1,
  finishRun = () => {};

/** One animation frame of the scene. */
function frame(at) {
  const start = performance.now();

  const id = monitor.beginFrame(at);

  // The previous frame was sealed by beginFrame, so the measured window ends here.
  if (id === stopAfter) {
    monitor.stopRecording();

    performance.mark("accuracy:end");

    finishRun(at);
  }

  const step = plan.shift();

  const count =
    step?.count ??
    Math.min(maxParticles, Math.round(stress.codeMs / sizes.perParticle));

  let spiking = step?.spike ?? false;

  if (!step && stress.spikeEveryMs && at >= nextSpike) {
    spiking = true;

    nextSpike = at + stress.spikeEveryMs;

    monitor.event("Rebuild spatial index");
  }

  statsJs.begin();

  statsGl.begin();

  const workStart = performance.now();

  let token = simulation.begin();

  simulate(count);

  simulation.end(token);

  const update = performance.now() - workStart,
    renderStart = performance.now();

  token = drawing.begin();

  draw(count);

  drawing.end(token);

  if (spiking) {
    token = sorting.begin();

    spike();

    sorting.end(token);
  }

  const workEnd = performance.now(),
    render = workEnd - renderStart;

  statsGl.end();

  statsJs.end();

  monitor.endFrame(update, render);

  statsGl.update();

  tray.refresh(at);

  // Render submission: the GPU layer and any new shader, inside the scope a game would use.
  if (!step && gl && (stress.gpuIterations || stress.shaderEveryMs)) {
    token = submitting.begin();

    if (stress.gpuIterations) drawGpu(at);

    if (stress.shaderEveryMs && at >= nextShader) {
      nextShader = at + stress.shaderEveryMs;

      monitor.event("New material");

      compileFreshShader();
    }

    submitting.end(token);

    gpu.captureFrame(id);
  }

  gpuCanvas.hidden = !stress.gpuIterations;

  // Browser and runtime work outside the game's scopes: what "outside your code" catches.
  if (!step) {
    if (stress.garbage) makeGarbage(stress.garbage);

    if (stress.layouts) forceLayouts(stress.layouts);
  }

  if (step) {
    log.push({
      id,
      at,
      start,
      end: performance.now(),
      workStart,
      workEnd,
      work: update + render,
      statsGl: statsGl.getData(),
    });

    if (!plan.length) stopAfter = id + 1;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.accuracy = {
  sizes,
  /** Runs light frames, then heavy frames with a spike every `spikeEvery` frames. */
  run({ light = 120, heavy = 90, spikeEvery = 30 } = {}) {
    return new Promise((done) => {
      log = [];

      statsJsReadings.FPS.length = statsJsReadings.MS.length = 0;

      plan = [
        ...Array.from({ length: light }, () => ({ count: sizes.light })),
        ...Array.from({ length: heavy }, (_, i) => ({
          count: sizes.heavy,
          // Mid-window, so each spike's long-animation-frame entry arrives before the run ends.
          spike: i % spikeEvery === spikeEvery >> 1,
        })),
      ];

      const loaf = [];

      const observer = new PerformanceObserver((list) =>
        loaf.push(...list.getEntries()),
      );

      observer.observe({ type: "long-animation-frame" });

      finishRun = (stopAt) => {
        observer.disconnect();

        const mark = performance.getEntriesByName("accuracy:start").at(-1);

        done({
          markStart: mark.startTime,
          stopAt,
          isolated: crossOriginIsolated,
          frames: log,
          recording: monitor.export(),
          statsJs: structuredClone(statsJsReadings),
          loaf: loaf.map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
            scripts: entry.scripts.map((script) => ({
              invoker: script.invokerType,
              startTime: script.startTime,
              duration: script.duration,
            })),
          })),
        });
      };

      performance.mark("accuracy:start");

      monitor.startRecording();
    });
  },
};

// The controls: each one adds a single kind of load, so the verdict's "where" can be checked.
for (const input of document.querySelectorAll("[data-stress]")) {
  const output = document.querySelector(`output[for="${input.id}"]`);

  const apply = () => {
    stress[input.dataset.stress] = Number(input.value);

    if (output) output.textContent = input.value;

    nextSpike = nextShader = 0;
  };

  input.addEventListener("input", apply);
  input.addEventListener("change", () =>
    monitor.event(
      `${input.labels[0].textContent}: ${input.selectedOptions?.[0]?.textContent ?? input.value}`,
    ),
  );

  apply();
}

// Prototype verdict: one fixed standard, judged over the last ten seconds.
const standard = {
  // 60 fps on every machine, so the same game gets the same verdict everywhere.
  fps: 60,
  // 57 of 60 frames a second still reads as smooth.
  smoothShare: 0.95,
  // Below this the game can't hold half the standard.
  tooSlowFps: 30,
  // A frame longer than this is a visible hitch; it's also the browser's long-animation-frame line.
  stutterMs: 50,
  // One stutter in the window is still smooth; more is not.
  stutters: 1,
  windowMs: 10_000,
  // Page load and calibration hitch the first frames; they aren't the game's steady state.
  settleMs: 2000,
};

const verdictState = document.querySelector("#verdict-state"),
  verdictDetail = document.querySelector("#verdict-detail");

let settledAt = null;

/** Your-code time per system across some frames, plus the total. */
function codeTime(samples) {
  const bySystem = new Map();

  let total = 0;

  for (const sample of samples)
    for (const scope of sample.scopes) {
      const ms = scope.end - scope.start;

      total += ms;

      bySystem.set(scope.label, (bySystem.get(scope.label) ?? 0) + ms);
    }

  const [top, topMs] = [...bySystem].toSorted((a, b) => b[1] - a[1])[0] ?? [
    "none",
    0,
  ];

  return { total, top, topMs };
}

/** The GPU's share of a frame, from recent timer-query samples, or why there's none. */
function gpuLine(frameMs) {
  if (gpu?.read().available !== true)
    return "  gpu         no GPU timing in this browser; it may be the GPU";

  const recent = gpuSamples.slice(-30);

  if (!recent.length) return "  gpu         waiting for GPU samples";

  const ms = recent.reduce((sum, sample) => sum + sample, 0) / recent.length;

  const bound = ms > frameMs * 0.8 ? " · GPU-bound" : "";

  return `  gpu         ${ms.toFixed(1)} ms · biggest fullscreen shader${bound}`;
}

/** Judges the window against the standard and says where the time goes when it misses. */
function judge() {
  if (plan.length) return;

  const { frames, events } = monitor.snapshot(false);

  const last = frames.at(-1);

  if (!last) return;

  settledAt ??= frames[0].at + standard.settleMs;

  const recent = frames.filter(
    (sample) => sample.at > Math.max(last.at - standard.windowMs, settledAt),
  );

  if (recent.length < 2) return;

  const seconds = (last.at - recent[0].at + recent[0].interval) / 1000;

  const fps = recent.length / seconds;

  const stutters = recent.filter(
    (sample) => sample.interval > standard.stutterMs,
  );

  let state = "SMOOTH";

  if (fps < standard.tooSlowFps) state = "TOO SLOW";
  else if (
    fps < standard.fps * standard.smoothShare ||
    stutters.length > standard.stutters
  )
    state = "NEEDS WORK";

  if (verdictState.textContent !== state) verdictState.textContent = state;

  verdictState.dataset.state = state;

  const lines = [
    `${fps.toFixed(0)} fps (standard ${standard.fps}) · ${stutters.length} stutters`,
  ];

  const detailed = recent.some((sample) => sample.coverage !== "unavailable");

  // Frames between stutters. When these keep up, the stutters are the whole problem, and
  // a per-frame split would only show idle time waiting for the next refresh.
  const steady = recent.filter(
    (sample) => sample.interval <= standard.stutterMs,
  );

  const steadyFps =
    (steady.length * 1000) /
    steady.reduce((sum, sample) => sum + sample.interval, 0);

  if (state !== "SMOOTH" && !detailed)
    lines.push("expand the panel to see which system");
  else if (steadyFps < standard.fps * standard.smoothShare) {
    // Averaged over every frame: Chrome's frame timestamps snap to the refresh under load,
    // so only totals split exactly between your code and everything else.
    const code = codeTime(steady);

    const frameMs = 1000 / steadyFps,
      codeMs = code.total / steady.length;

    lines.push(
      `per frame ${frameMs.toFixed(1)} ms (target ${(1000 / standard.fps).toFixed(1)}):`,
      `  your code   ${codeMs.toFixed(1)} ms · biggest ${code.top} ${(code.topMs / steady.length).toFixed(1)} ms`,
      `  everything else ${(frameMs - codeMs).toFixed(1)} ms (browser, GC, GPU wait)`,
    );

    if (stress.gpuIterations) lines.push(gpuLine(frameMs));
  }

  if (stutters.length && detailed) {
    const code = codeTime(stutters);

    const longMs =
      stutters.reduce((sum, sample) => sum + sample.interval, 0) /
      stutters.length;

    const near = new Set();

    for (const sample of stutters) {
      const event = events.find(
        (candidate) => Math.abs(candidate.at - sample.at) < 250,
      );

      if (event) near.add(event.label);
    }

    lines.push(
      `stutters avg ${longMs.toFixed(0)} ms:`,
      `  your code   ${(code.total / stutters.length).toFixed(0)} ms · biggest ${code.top}`,
      `  everything else ${(longMs - code.total / stutters.length).toFixed(0)} ms`,
      `  near ${near.size ? [...near].slice(0, 2).join(", ") : "no event"}`,
    );

    if (stress.gpuIterations) lines.push(gpuLine(longMs));
  }

  verdictDetail.textContent = lines.join("\n");
}

setInterval(judge, 250);
