import * as THREE from "three";
import { readThreeRendererCounters } from "../../packages/jank/src/adapters/three-counters.ts";
import type { GpuWorkload } from "./gpu-workload-options.ts";
import { createGpuProbe } from "./gpu-workloads.ts";
import { createSceneDiagnostics } from "./scene-diagnostics.ts";

/** The scene owns its renderer/resources. Profiling and scheduling belong to the host. */
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.info.autoReset = false;
  const context = renderer.getContext();
  if (!("beginQuery" in context)) {
    renderer.dispose();
    throw new Error("The demo requires WebGL2");
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1015);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
  camera.position.set(9, 10, 13);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xe5f2ff, 0x28323b, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 8, 4);
  scene.add(light);
  const grid = new THREE.GridHelper(12, 12, 0x526676, 0x253039);
  scene.add(grid);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const neutral = new THREE.MeshStandardMaterial({ color: 0x7799aa, roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf26032, roughness: 0.6 });
  const cubes: THREE.Mesh[] = [];
  const diagnostics = createSceneDiagnostics({ canvas, camera, cubes });
  let inspectionView = false;
  let activeCount = 0;
  let probe: ReturnType<typeof createGpuProbe> | null = null;
  let probeIterations = 0;
  let probeMode: GpuWorkload = "arithmetic";
  let elapsedSeconds = 0;
  let resolutionScale = 1;

  function setCount(count: number): void {
    if (count === activeCount) {
      return;
    }
    activeCount = count;
    diagnostics.reset();
    while (cubes.length < count) {
      const cube = new THREE.Mesh(geometry, cubes.length % 9 === 0 ? accent : neutral);
      cubes.push(cube);
      scene.add(cube);
    }
    const columns = Math.ceil(Math.sqrt(count));
    const spacing = 8 / columns;
    cubes.forEach((cube, index) => {
      cube.visible = index < count;
      cube.scale.setScalar(spacing * 0.52);
      cube.position.set(
        ((index % columns) - (columns - 1) / 2) * spacing,
        spacing * 0.5,
        (Math.floor(index / columns) - (columns - 1) / 2) * spacing,
      );
    });
  }

  function resizeRenderer(): void {
    const { width, height } = canvas.getBoundingClientRect();
    if (width > 0 && height > 0) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * resolutionScale);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }
  const resize = new ResizeObserver(resizeRenderer);
  resize.observe(canvas);
  setCount(36);
  return {
    context,
    visibility: diagnostics.visibility,
    temporal: diagnostics.temporal,
    toggleInspectionView: () => {
      inspectionView = !inspectionView;
      camera.position.set(inspectionView ? 2 : 9, inspectionView ? 1 : 10, inspectionView ? 2 : 13);
      camera.lookAt(0, 0, 0);
      diagnostics.reset();
    },
    setCount,
    resolutionScale: () => resolutionScale,
    setResolutionScale: (scale: number) => {
      resolutionScale = scale;
      resizeRenderer();
    },
    animationTime: () => elapsedSeconds,
    setAnimationTime: (seconds: number) => {
      elapsedSeconds = seconds;
    },
    update: (deltaSeconds: number) => {
      elapsedSeconds += deltaSeconds;
      for (let index = 0; index < activeCount; index += 1) {
        const cube = cubes[index];
        if (cube) {
          cube.rotation.set(elapsedSeconds * 0.3 + index * 0.1, elapsedSeconds * 0.45, 0);
        }
      }
    },
    render: () => {
      scene.updateMatrixWorld(true);
      diagnostics.update(activeCount);
      renderer.info.reset();
      renderer.render(scene, camera);
      if (probeIterations > 0) {
        probe ??= createGpuProbe(renderer, probeMode);
        probe.render(probeIterations);
      }
    },
    stressGpu: (iterations: number, mode: GpuWorkload = "arithmetic") => {
      if (probeMode !== mode) {
        probe?.dispose();
        probe = null;
        probeMode = mode;
      }
      probeIterations = iterations;
    },
    clearStress: (count: number) => {
      probeIterations = 0;
      probe?.dispose();
      probe = null;
      setCount(count);
      for (const cube of cubes.splice(count)) {
        scene.remove(cube);
      }
    },
    counters: () => ({
      objects: activeCount,
      gpuWorkload: probeIterations > 0 ? probeMode : "off",
      gpuWorkUnits: probeIterations,
      ...readThreeRendererCounters(renderer.info, "webgl"),
    }),
    dispose: () => {
      resize.disconnect();
      diagnostics.dispose();
      probe?.dispose();
      geometry.dispose();
      neutral.dispose();
      accent.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((material) => {
          material.dispose();
        });
      } else {
        grid.material.dispose();
      }
      renderer.dispose();
    },
  };
}
