import * as THREE from "three";
import { createGpuProbe } from "./headroom-workloads.ts";

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
  let activeCount = 0;
  let probe: ReturnType<typeof createGpuProbe> | null = null;
  let probeIterations = 0;
  let elapsedSeconds = 0;

  function setCount(count: number): void {
    if (count === activeCount) {
      return;
    }
    activeCount = count;
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

  const resize = new ResizeObserver(() => {
    const { width, height } = canvas.getBoundingClientRect();
    if (width > 0 && height > 0) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  });
  resize.observe(canvas);
  setCount(36);
  return {
    context,
    setCount,
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
      renderer.info.reset();
      renderer.render(scene, camera);
      if (probeIterations > 0) {
        probe ??= createGpuProbe(renderer);
        probe.render(probeIterations);
      }
    },
    stressGpu: (iterations: number) => {
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
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    }),
    dispose: () => {
      resize.disconnect();
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
