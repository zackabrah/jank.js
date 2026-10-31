import * as THREE from "three/webgpu";
import { createThreeWebGpuSource } from "../../../packages/jank/src/adapters/three-webgpu.ts";
import { nativeTimestampControl } from "./clear-query.ts";
import { observeGpuDevice } from "./evidence.ts";

declare global {
  interface Window {
    timestampDiagnostic: typeof diagnose;
  }
}
window.timestampDiagnostic = diagnose;

async function diagnose() {
  const renderer = new THREE.WebGPURenderer();
  await renderer.init();
  if (!renderer.hasFeature("timestamp-query") || !("device" in renderer.backend)) {
    await renderer.dispose();
    return { status: "unsupported" as const };
  }
  const device = renderer.backend.device;
  if (!(device instanceof GPUDevice)) {
    throw new Error("Missing native device");
  }
  const errors: string[] = [];
  const onError = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
  device.addEventListener("uncapturederror", onError);
  // This control uses native WebGPU, before Jank's adapter is attached.
  const native = await nativeTimestampControl(device);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.5, 0.5, 0.5);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0, 0.1, 10000, { size: 128 });
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 3;
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const drawScene = new THREE.Scene();
  drawScene.add(new THREE.Mesh(geometry, material));
  await renderer.compileAsync(drawScene, camera);
  renderer.render(drawScene, camera);
  await device.queue.onSubmittedWorkDone();
  const observer = observeGpuDevice(device);
  const source = createThreeWebGpuSource(renderer, { revision: THREE.REVISION, enabled: true });
  const frames = [];
  try {
    for (let frameId = 1; frameId <= 12; frameId += 1) {
      source.beginFrame(frameId);
      observer.begin();
      source.withPass({ id: "reflections", label: "Environment reflections" }, () => {
        if (frameId % 2) {
          renderer.render(drawScene, camera);
        } else {
          generator.fromScene(scene, 0, 0.1, 10000, { size: 128, renderTarget: target });
        }
      });
      const reference = observer.read();
      source.endFrame();
      const [raw, resolution] = await Promise.all([
        reference,
        source.resolveFrames([frameId], { timeoutMs: 2000 }),
      ]);
      frames.push({ raw, resolution });
    }
    return { status: "ready" as const, native, frames, errors, userAgent: navigator.userAgent };
  } finally {
    source.dispose();
    target.dispose();
    generator.dispose();
    geometry.dispose();
    material.dispose();
    device.removeEventListener("uncapturederror", onError);
    await renderer.dispose();
  }
}
