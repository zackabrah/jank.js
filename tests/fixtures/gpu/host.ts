import * as THREE from "three";
import type { GpuAdapter } from "../../../packages/jank/src/adapters/gpu-adapter.ts";
import { createThreeWebGpuSource } from "../../../packages/jank/src/adapters/three-webgpu.ts";
import { createWebGl2GpuSource } from "../../../packages/jank/src/adapters/webgl2.ts";
import { createPanel, createProfiler, type Profiler } from "../../../packages/jank/src/index.ts";

declare global {
  interface Window {
    gpuFixture: { source: GpuAdapter; profiler: Profiler; frames(): number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (!canvas) {
  throw new Error("Missing fixture canvas");
}
const profiler = createProfiler();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 10);
camera.position.z = 4;
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0xf26032 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

async function rendererFor(canvas: HTMLCanvasElement) {
  if (new URLSearchParams(location.search).get("backend") === "webgpu") {
    const { WebGPURenderer } = await import("three/webgpu");
    const renderer = new WebGPURenderer({ canvas, trackTimestamp: true });
    renderer.setSize(320, 240);
    await renderer.init();
    const source = createThreeWebGpuSource(renderer, {
      revision: THREE.REVISION,
      onSample: profiler.observeGpu,
    });
    return {
      source,
      render: () => renderer.render(scene, camera),
      dispose: () => renderer.dispose(),
    };
  }
  const renderer = new THREE.WebGLRenderer({ canvas });
  const context = renderer.getContext();
  if (!("beginQuery" in context)) {
    renderer.dispose();
    throw new Error("The GPU fixture requires WebGL2");
  }
  renderer.setSize(320, 240);
  const source = createWebGl2GpuSource(context, { onSample: profiler.observeGpu });
  return {
    source,
    render: () => {
      source.beginPass("cube render");
      renderer.render(scene, camera);
      source.endPass();
    },
    dispose: () => renderer.dispose(),
  };
}

const host = await rendererFor(canvas);
const panel = createPanel({ container: document.body, profiler, gpu: host.source, mode: "full" });
profiler.capture.start();
let frameCount = 0;
let request = 0;
function frame(atMs: number): void {
  frameCount += 1;
  const frameId = profiler.beginFrame(atMs);
  cube.rotation.y += 0.01;
  host.render();
  host.source.captureFrame(frameId > 0 ? frameId : null);
  profiler.observeGpu(host.source.read());
  panel.refresh(atMs);
  request = requestAnimationFrame(frame);
}
window.gpuFixture = { source: host.source, profiler, frames: () => frameCount };
request = requestAnimationFrame(frame);
document.body.dataset.ready = "true";
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(request);
    panel.dispose();
    host.source.dispose();
    profiler.dispose();
    host.dispose();
    geometry.dispose();
    material.dispose();
  },
  { once: true },
);
