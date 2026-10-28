import { execFileSync } from "node:child_process";

import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";

import { tmpdir } from "node:os";

import { join, resolve } from "node:path";

import assert from "node:assert/strict";

const root = process.cwd();

const temp = await mkdtemp(join(tmpdir(), "jank-consumer-"));

const win32 = "win32";

const windows = process.platform === win32;

const npm = windows ? "npm.cmd" : "npm";

/** Path to a locally installed CLI, with the .cmd shim on Windows. */
const executable = (name) =>
  resolve("node_modules/.bin", name + (windows ? ".cmd" : ""));

/** Runs a command synchronously and captures its output; Windows needs a shell for .cmd shims. */
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "pipe",
    ...(windows ? { shell: true } : {}),
  });

try {
  run(npm, ["pack", "--ignore-scripts", "--pack-destination", temp], root);

  const archive = (await readdir(temp)).find((name) => name.endsWith(".tgz"));

  assert.ok(archive);

  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );

  run(
    npm,
    [
      "install",
      join(temp, archive),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    temp,
  );

  const installed = join(temp, "node_modules/jank.js");

  const packageFiles = await readdir(installed, { recursive: true });

  assert.ok(
    !packageFiles.some(
      (file) =>
        file.includes("local-assets") ||
        file.includes("hero/") ||
        file.includes("examples/") ||
        /\.(glb|gltf|fbx|mp3|wav|ttf)$/i.test(file),
    ),
    "The library package must not include local or demo scene assets",
  );

  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );

  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);

  await Promise.all(
    [
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "README.md",
      // Targets of the packaged README and CONTRIBUTING links.
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "licenses/ibm-plex-mono-OFL.txt",
      "licenses/shadcn-ui.txt",
      "dist-package/style.css",
      "dist-package/font.css",
      "dist-package/viewer.html",
    ].map((file) => readFile(join(installed, file))),
  );

  const viewer = await readFile(
    join(installed, "dist-package/viewer.html"),
    "utf8",
  );

  assert.ok(viewer.includes("jank.js recording viewer"));
  assert.ok(viewer.includes("Recording file"));
  assert.ok(!viewer.includes("@font-face"), "The viewer must use system fonts");
  assert.ok(
    !packageFiles.some((file) => /\.(woff2?|otf|ttf)$/i.test(file)),
    "The package must not ship font binaries",
  );

  const font = await readFile(join(installed, "dist-package/font.css"), "utf8");

  assert.ok(
    !/@font-face|url\(|@import/i.test(font),
    "The legacy font.css entry must not load fonts",
  );
  assert.equal(manifest.exports["./viewer.html"], "./dist-package/viewer.html");
  assert.ok(!manifest.devDependencies.gsap);

  const style = await readFile(
    join(installed, "dist-package/style.css"),
    "utf8",
  );

  assert.ok(
    style.includes("--jank-miss") && !style.includes("@import"),
    "style.css must carry the jank.js tokens inline",
  );

  await writeFile(
    join(temp, "consumer.mjs"),
    `import { buildInfo, createDiagnostics, createPreparationProfiler, createRecordingViewModel, serializeRecording } from 'jank.js';
import { createThreeWebGpuSource } from 'jank.js/adapters/three-webgpu';
import { registerThreeRenderer } from 'jank.js/adapters/three';
import { createWebGl2GpuSource } from 'jank.js/adapters/webgl2';
import assert from 'node:assert/strict';
assert.equal(buildInfo.version, ${JSON.stringify(manifest.version)});
assert.match(buildInfo.commit, /^[a-f0-9]{40}$/);
const monitor = createDiagnostics(); monitor.frame(performance.now(), 16, 1, 2);
assert.equal(monitor.snapshot().frames.length, 1);
assert.equal(monitor.export().format, 'jank.js-recording');
assert.equal(monitor.export().metadata.jankVersion, ${JSON.stringify(manifest.version)}, 'Recordings must carry the package version; update src/core/environment.ts');
const view = createRecordingViewModel(); view.load(serializeRecording(monitor.export()));
assert.equal(view.snapshot().summary.frames, 1);
assert.equal(view.snapshot().selected.attribution, 'unavailable');
const gpu = createThreeWebGpuSource({info:{frame:0},backend:{},hasFeature:()=>false,resolveTimestampsAsync:async()=>undefined},{revision:'186'});
assert.equal(gpu.read().status, 'unsupported'); gpu.dispose();
const webgl = createWebGl2GpuSource({QUERY_RESULT:0,QUERY_RESULT_AVAILABLE:0,getExtension:()=>null,getParameter:()=>null,isContextLost:()=>false,createQuery:()=>null,deleteQuery(){},beginQuery(){},endQuery(){},getQueryParameter:()=>null});
assert.equal(webgl.read().status, 'unsupported'); webgl.dispose();
const channel = registerThreeRenderer(monitor, { render: { calls: 3, triangles: 12, points: 0, lines: 0 }, memory: { geometries: 1, textures: 0 } });
assert.equal(monitor.snapshot().systems[0].values.drawCalls, 3);
const preparation = createPreparationProfiler(); preparation.start({label:'Test',kind:'fresh-context'}); preparation.measure('audio',()=>42); assert.equal(preparation.snapshot().stages[0].stage,'audio');
channel.dispose(); monitor.dispose();`,
  );

  run(process.execPath, ["consumer.mjs"], temp);

  await writeFile(
    join(temp, "consumer.ts"),
    `import { createDiagnostics, createPerformanceTray, createRecordingViewModel, parseRecording, inspectFrame, type PerformanceRecording, type PerformanceTrayOptions, type GpuProfile } from 'jank.js';
import { createThreeWebGpuSource, type ThreeTimestampRenderer } from 'jank.js/adapters/three-webgpu';
import { registerThreeRenderer, type ThreeRendererInfo } from 'jank.js/adapters/three';
import { createWebGl2GpuSource } from 'jank.js/adapters/webgl2';
const options: PerformanceTrayOptions = { shell: document.body, monitor: createDiagnostics() };
createPerformanceTray(options).dispose();
export type Profile = GpuProfile;
const viewer = createRecordingViewModel(); viewer.clear();
export function recording(text: string): PerformanceRecording { return parseRecording(text); }
export function frame(data: PerformanceRecording, id: number) { return inspectFrame(data, id); }
export function timestamps(renderer: ThreeTimestampRenderer) { return createThreeWebGpuSource(renderer, {revision:'186'}); }
export function counters(info: ThreeRendererInfo) { return registerThreeRenderer(options.monitor, info); }
export function webglTray(gl: WebGL2RenderingContext) { return createPerformanceTray({ ...options, gpu: createWebGl2GpuSource(gl) }); }`,
  );

  run(
    executable("tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "es2023",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "consumer.ts",
    ],
    temp,
  );

  await writeFile(
    join(temp, "index.html"),
    '<main id="app"></main><script type="module" src="/main.js"></script>',
  );

  await writeFile(
    join(temp, "main.js"),
    `import { createDiagnostics, createPerformanceTray } from 'jank.js'; import 'jank.js/style.css'; import 'jank.js/font.css'; createPerformanceTray({shell:document.querySelector('#app'),monitor:createDiagnostics()});`,
  );

  run(executable("vite"), ["build"], temp);

  console.log(
    "Package verified: isolated install, zero runtime dependencies, public imports, declarations, system fonts, CSS assets and consumer build.",
  );
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());

  if (error.stderr) console.error(error.stderr.toString());

  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
