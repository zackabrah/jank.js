import * as THREE from "three";
import type { GpuAdapter } from "../../../packages/jank/src/adapters/gpu-adapter.ts";
import { isTimestampBackend } from "../../../packages/jank/src/adapters/three-timestamp-owner.ts";
import { createThreeWebGpuSource } from "../../../packages/jank/src/adapters/three-webgpu.ts";
import { createWebGl2GpuSource } from "../../../packages/jank/src/adapters/webgl2.ts";
import { createPanel, createProfiler, type Profiler } from "../../../packages/jank/src/index.ts";
import { observeGpuDevice } from "./evidence.ts";

declare global {
  interface Window {
    gpuFixture: {
      source: GpuAdapter;
      profiler: Profiler;
      frames(): number;
      reference(): ReturnType<NonNullable<Awaited<ReturnType<typeof rendererFor>>["reference"]>>;
      benchmark(): ReturnType<NonNullable<Awaited<ReturnType<typeof rendererFor>>["benchmark"]>>;
    };
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
    const { WebGPURenderer, StorageBufferAttribute } = await import("three/webgpu");
    const { Fn, instanceIndex, storage, float } = await import("three/tsl");
    const renderer = new WebGPURenderer({ canvas, trackTimestamp: false });
    renderer.setSize(320, 240);
    await renderer.init();
    const nativeWebGpu =
      "isWebGPUBackend" in renderer.backend && renderer.backend.isWebGPUBackend === true;
    const values = storage(new StorageBufferAttribute(256, 1), "float", 256);
    const compute = Fn(() => {
      values.element(instanceIndex).assign(float(instanceIndex).sin());
    })().compute(256);
    if (nativeWebGpu) {
      await renderer.computeAsync(compute);
    }
    await renderer.compileAsync(scene, camera);
    const evidence = isTimestampBackend(renderer.backend)
      ? observeGpuDevice(renderer.backend.device)
      : null;
    const attach = (enabled: boolean) =>
      createThreeWebGpuSource(renderer, {
        revision: THREE.REVISION,
        enabled,
        onSample: profiler.observeGpu,
      });
    let source = attach(true);
    const draw = (timing: typeof source | null) => {
      const computePass = () => renderer.compute(compute);
      const renderPass = () => renderer.render(scene, camera);
      const submitCompute = timing
        ? () =>
            timing.withPass(
              { id: "fill", label: "Compute fill", category: "simulation" },
              computePass,
            )
        : computePass;
      const submitRender = timing
        ? () =>
            timing.withPass({ id: "scene", label: "Main scene", category: "graphics" }, renderPass)
        : renderPass;
      if (nativeWebGpu) {
        submitCompute();
        submitCompute();
      }
      submitRender();
      submitRender();
    };
    let referenceRequest: ReturnType<
      typeof Promise.withResolvers<{
        frameId: number | null;
        raw: Awaited<ReturnType<NonNullable<typeof evidence>["read"]>>;
        result: Awaited<ReturnType<typeof source.resolveFrames>>;
      }>
    > | null = null;
    return {
      source,
      reference: () => {
        if (!evidence || referenceRequest) {
          throw new Error("Reference capture unavailable");
        }
        referenceRequest = Promise.withResolvers();
        return referenceRequest.promise;
      },
      render: (frameId: number | null) => {
        source.beginFrame(frameId);
        const request = referenceRequest;
        referenceRequest = null;
        if (request) {
          evidence?.begin();
        }
        draw(source);
        const raw = request ? evidence?.read() : null;
        source.endFrame();
        if (request && raw) {
          void Promise.all([
            raw,
            source.resolveFrames(frameId === null ? [] : [frameId], { timeoutMs: 2000 }),
          ]).then(
            ([intervals, result]) => request.resolve({ frameId, raw: intervals, result }),
            request.reject,
          );
        }
      },
      benchmark: async () => {
        const batches = [];
        const sampleBatch = async (timing: typeof source | null, count: number) => {
          const durations = [];
          for (let frame = 0; frame < count; frame += 1) {
            await new Promise(requestAnimationFrame);
            const start = performance.now();
            timing?.beginFrame(null);
            draw(timing);
            timing?.endFrame();
            durations.push(performance.now() - start);
          }
          return durations;
        };
        // Rotate modes to expose warmup/order effects. Readbacks remain asynchronous.
        for (const mode of [
          "none",
          "disabled",
          "enabled",
          "enabled",
          "none",
          "disabled",
          "disabled",
          "enabled",
          "none",
        ] as const) {
          source.dispose();
          const timing = mode === "none" ? null : attach(mode === "enabled");
          if (timing) {
            source = timing;
          }
          await sampleBatch(timing, 20);
          const before = evidence?.resources();
          const durationsMs = await sampleBatch(timing, 120);
          const after = evidence?.resources();
          batches.push({ mode, durationsMs, before, after, diagnostics: timing?.diagnostics() });
        }
        source.dispose();
        return { batches, afterDispose: evidence?.resources(), userAgent: navigator.userAgent };
      },
      dispose: () => {
        source.dispose();
        compute.dispose();
        renderer.dispose();
      },
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
    reference: undefined,
    benchmark: undefined,
    render: (frameId: number | null) => {
      source.beginPass("cube render");
      renderer.render(scene, camera);
      source.endPass();
      source.captureFrame(frameId);
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
  host.render(frameId > 0 ? frameId : null);
  profiler.observeGpu(host.source.read());
  panel.refresh(atMs);
  request = requestAnimationFrame(frame);
}
window.gpuFixture = {
  source: host.source,
  profiler,
  frames: () => frameCount,
  reference: () => {
    if (!host.reference) {
      throw new Error("WebGPU required");
    }
    return host.reference();
  },
  benchmark: () => {
    if (!host.benchmark) {
      throw new Error("WebGPU required");
    }
    cancelAnimationFrame(request);
    return host.benchmark();
  },
};
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
