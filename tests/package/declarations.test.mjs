import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("installable profiler archive includes usage and integration guides", () => {
  const directory = mkdtempSync(join(tmpdir(), "jank-package-docs-"));
  try {
    const packed = spawnSync("pnpm", ["pack", "--pack-destination", directory], {
      cwd: resolve("packages/jank"),
      encoding: "utf8",
    });
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const archive = readdirSync(directory).find((name) => name.endsWith(".tgz"));
    assert.ok(archive, "Package archive exists");
    const contents = spawnSync("tar", ["-tzf", join(directory, archive)], { encoding: "utf8" });
    assert.equal(contents.status, 0, contents.stderr);
    for (const file of ["docs/USAGE.md", "docs/INTEGRATION.md", "LICENSE", "dist/index.js"]) {
      assert.ok(contents.stdout.split("\n").includes(`package/${file}`), `${file} is shipped`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("built profiler and both declaration packages work without workspace source files", () => {
  const directory = mkdtempSync(join(tmpdir(), "jank-package-consumer-"));
  try {
    for (const [folder, name] of [
      ["jank", "jank.js"],
      ["junkui", "junkui"],
    ]) {
      const destination = join(directory, "node_modules", name);
      mkdirSync(destination, { recursive: true });
      cpSync(`packages/${folder}/package.json`, join(destination, "package.json"));
      cpSync(`packages/${folder}/dist`, join(destination, "dist"), { recursive: true });
    }
    cpSync("node_modules/@types/web", join(directory, "node_modules/@types/web"), {
      recursive: true,
      dereference: true,
    });
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2025",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2025"],
          types: ["@types/web"],
          strict: true,
          noUncheckedSideEffectImports: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      }),
    );
    writeFileSync(
      join(directory, "consumer.ts"),
      `
import type { Channel, CreateProfiler, ScopeToken, ProfilerSnapshot } from "jank.js";
import { createPanel, createProfiler, createLoadingProfiler, createViewer, parseComparison, finalizeRecording, inspectFrame, summarizeGpuCoverage, type InspectFrame } from "jank.js";
import { readThreeRendererCounters } from "jank.js/adapters/three-counters";
import { createWebGl2GpuSource } from "jank.js/adapters/webgl2";
import { createThreeWebGpuSource, type ThreeTimestampRenderer } from "jank.js/adapters/three-webgpu";
declare const gl: WebGL2RenderingContext;
declare const renderer: ThreeTimestampRenderer;
const webgl = createWebGl2GpuSource(gl);
const webgpu = createThreeWebGpuSource(renderer, { revision: "186" });
webgl.beginPass("render");
webgl.endPass();
webgl.captureFrame(null);
webgl.dispose();
webgpu.beginFrame(null);
webgpu.withPass({ id: "scene", label: "Scene" }, () => {});
webgpu.endFrame();
webgpu.dispose();
import "jank.js/styles.css";
import { createTabs, type CreateTabs } from "junkui";
import "junkui/styles.css";
declare const stopped: import("jank.js").Recording;
const inspect: InspectFrame = inspectFrame;
const inspected = inspect(stopped, 1);
summarizeGpuCoverage(stopped).coveragePercent?.toFixed(1);
if (inspected) {
  inspected.coverage.status.toUpperCase();
  inspected.likelyCause?.aboveMedianMs.toFixed(2);
}
const finalized: import("jank.js").RecordingFinalization = await finalizeRecording(stopped, webgpu, { timeoutMs: 100 });
finalized.missingFrameIds.forEach(id => id.toFixed());
const factory: CreateProfiler = createProfiler;
const tabsFactory: CreateTabs = createTabs;
declare const tablist: HTMLElement;
declare const button: HTMLButtonElement;
declare const panel: HTMLElement;
const profiler = factory({ targetFps: 60 });
const loading = createLoadingProfiler();
loading.beginRun({ label: "Level", kind: "fresh-context" }).measure("build", () => 42);
loading.dispose();
const viewer = createViewer({ container: panel });
viewer.import("{}");
const comparisonFile = parseComparison("{}");
if (comparisonFile.ok) { viewer.loadComparison(comparisonFile.comparison); }
viewer.dispose();
const livePanel = createPanel({ container: panel, profiler });
livePanel.refresh(100);
livePanel.dispose();
const channel: Channel = profiler.createChannel({ id: "physics", label: "Physics" });
const token: ScopeToken = channel.begin();
channel.end(token);
const snapshot: ProfilerSnapshot = profiler.snapshot();
snapshot.frames.forEach(frame => frame.scopes.forEach(scope => scope.channelId));
// @ts-expect-error Consumers cannot fabricate a scope token from a timestamp.
channel.end(100);
// @ts-expect-error Public nested snapshots are readonly.
snapshot.frames[0].cpu.updateMs = 123;
const tabs = tabsFactory({ tablist, tabs: [{ id: "main", button, panel }], selectedId: "main" });
tabs.dispose();
`,
    );
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "-p", join(directory, "tsconfig.json")],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeFileSync(
      join(directory, "runtime.mjs"),
      `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPanel, createProfiler, createLoadingProfiler, finalizeRecording, inspectFrame, summarizeGpuCoverage, parseRecording, serializeRecording } from "jank.js";
import { createTabs } from "junkui";
import { readThreeRendererCounters } from "jank.js/adapters/three-counters";
import { createWebGl2GpuSource } from "jank.js/adapters/webgl2";
import { createThreeWebGpuSource } from "jank.js/adapters/three-webgpu";
assert.equal(readThreeRendererCounters(null, "webgpu").drawCalls, null);
assert.equal(typeof createWebGl2GpuSource, "function");
assert.equal(typeof createThreeWebGpuSource, "function");
assert.equal(typeof createTabs, "function");
assert.equal(typeof createPanel, "function");
const css = readFileSync(new URL(import.meta.resolve("junkui/styles.css")), "utf8");
assert.ok(css.includes(".jl") && css.includes("--jl-ink") && css.includes(":focus-visible"));
assert.doesNotMatch(css, /@import|url\\(/u, "Shipped CSS must be self-contained");
const panelCss = readFileSync(new URL(import.meta.resolve("jank.js/styles.css")), "utf8");
assert.ok(panelCss.includes(".jank") && panelCss.includes("--jl-ink"));
assert.doesNotMatch(panelCss, /@import|url\\(/u);
let timeMs = 0;
const profiler = createProfiler({ now: () => timeMs });
const loading = createLoadingProfiler({ now: () => timeMs });
const load = loading.beginRun({ label: "Level", kind: "fresh-context" });
load.measure("build", () => 42);
load.finish("ready");
assert.equal(loading.history().length, 1);
loading.dispose();
const channel = profiler.createChannel({ id: "physics", label: "Physics", readCounters: () => ({ bodies: 10 }) });
profiler.capture.start();
profiler.beginFrame(timeMs);
const token = channel.begin();
timeMs = 5;
channel.end(token);
profiler.endFrame({ updateMs: 5, renderMs: 0 });
timeMs = 16;
profiler.beginFrame(timeMs);
const recording = profiler.capture.stop();
assert.ok(recording);
assert.equal(recording.frames.length, 1);
assert.equal(recording.frames[0].scopes[0].channelId, "physics");
assert.equal(recording.counters[0].values.bodies, 10);
const inspected = inspectFrame(recording, recording.frames[0].id);
assert.equal(inspected.attributedMs, 5);
assert.equal(inspected.unattributedMs, 11);
assert.equal(inspected.coverage.status, "complete");
assert.equal(inspected.likelyCause, null);
assert.equal(inspectFrame(recording, -1), null);
assert.equal(summarizeGpuCoverage(recording).missingFrames, 1);
assert.equal(profiler.capture.getProgress().kind, "recent");
const manifest = JSON.parse(readFileSync(new URL("node_modules/jank.js/package.json", import.meta.url), "utf8"));
assert.equal(recording.metadata.toolVersion, manifest.version);
assert.deepEqual(parseRecording(serializeRecording(recording)), { ok: true, recording });
assert.equal(parseRecording('{').problem.code, "invalid-json");
const finalized = await finalizeRecording(recording, {
  resolveFrames: async () => ({ status: "unavailable", samples: [], pendingFrameIds: [] }),
});
assert.equal(finalized.complete, false);
assert.equal(finalized.status, "unavailable");
assert.deepEqual(finalized.missingFrameIds, [recording.frames[0].id]);
assert.equal(parseRecording(serializeRecording(finalized.recording)).ok, true);
profiler.dispose();
`,
    );
    const runtime = spawnSync(process.execPath, [join(directory, "runtime.mjs")], {
      encoding: "utf8",
    });
    assert.ifError(runtime.error);
    assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
    rmSync(join(directory, "node_modules/junkui"), { recursive: true });
    const standalone = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from "node:assert/strict";
import { createPanel, createViewer, parseComparison } from "jank.js";
import { readThreeRendererCounters } from "jank.js/adapters/three-counters";
import { createWebGl2GpuSource } from "jank.js/adapters/webgl2";
import { createThreeWebGpuSource } from "jank.js/adapters/three-webgpu";
for (const factory of [createPanel, createViewer, parseComparison, createWebGl2GpuSource, createThreeWebGpuSource]) {
  assert.equal(typeof factory, "function");
}
assert.throws(() => import.meta.resolve("junkui"));
assert.throws(() => import.meta.resolve("three"));`,
      ],
      { cwd: directory, encoding: "utf8" },
    );
    assert.ifError(standalone.error);
    assert.equal(standalone.status, 0, standalone.stdout + standalone.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
