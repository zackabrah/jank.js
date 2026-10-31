import * as THREE from "three";
import {
  createBoundsOverlay,
  type DebugBounds,
  type TemporalSnapshot,
  type TemporalSource,
  type VisibilitySource,
} from "../../packages/jank/src/index.ts";

interface SceneDiagnosticsOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  cubes: readonly THREE.Mesh[];
}

/** Demo-owned AABB culling and CPU projected-corner history. No GPU velocity buffer or TAA is claimed. */
export function createSceneDiagnostics({ canvas, camera, cubes }: SceneDiagnosticsOptions) {
  const overlay = createBoundsOverlay(canvas);
  const temporalCanvas = document.createElement("canvas");
  temporalCanvas.dataset.demoTemporal = "";
  temporalCanvas.setAttribute(
    "aria-label",
    "CPU-projected corner motion and transform history preview",
  );
  temporalCanvas.style.cssText = "position:fixed;pointer-events:none;z-index:9;display:none";
  document.body.append(temporalCanvas);
  const context = temporalCanvas.getContext("2d");
  if (!context) {
    throw new Error("Demo diagnostics require a 2D canvas");
  }
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const bounds: DebugBounds[] = [];
  const previous = new Map<THREE.Mesh, THREE.Vector3>();
  let enabled = true;
  let debugBounds = false;
  let objectMotion = false;
  let debugView: TemporalSnapshot["debugView"] = "none";
  let tested = 0;
  let visible = 0;
  let rigid = 0;
  let disposed = false;
  const visibility: VisibilitySource = {
    read: () =>
      disposed
        ? null
        : {
            enabled,
            debugBounds,
            views: [{ name: "Main", tested, visible, culled: tested - visible }],
            distance: null,
            instances: null,
            note: "Cube AABB decisions only; grid excluded. No instanced meshes in this scene.",
          },
    setEnabled: (value) => {
      enabled = value;
    },
    setDebugBounds: (value) => {
      debugBounds = value;
    },
  };
  const temporal: TemporalSource = {
    read: () =>
      disposed
        ? null
        : {
            objectMotion,
            debugView,
            eligibleBatches: tested,
            rigidBatches: rigid,
            rejectedBatches: tested - rigid,
            note: "CPU-projected corner motion ×12 / transform history preview; not GPU velocity or TAA.",
          },
    setEnabled: (value) => {
      objectMotion = value;
      previous.clear();
    },
    setDebugView: (value) => {
      debugView = value;
    },
  };
  function updateHistory(cube: THREE.Mesh): void {
    point.set(0.5, 0.5, 0.5).applyMatrix4(cube.matrixWorld).applyMatrix4(viewProjection);
    const last = previous.get(cube);
    const valid = objectMotion && Boolean(last);
    if (valid) {
      rigid += 1;
    }
    if (debugView !== "none" && context) {
      drawMotion(context, { current: point, previous: last, valid, view: debugView });
    }
    if (objectMotion) {
      if (last) {
        last.copy(point);
      } else {
        previous.set(cube, point.clone());
      }
    }
  }
  function updateCube(cube: THREE.Mesh): void {
    box.setFromObject(cube);
    const culled = enabled && !frustum.intersectsBox(box);
    cube.frustumCulled = false;
    cube.visible = !culled;
    if (!culled) {
      visible += 1;
    }
    if (debugBounds && bounds.length < 128) {
      bounds.push({
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
        culled,
      });
    }
    if (objectMotion || debugView !== "none") {
      updateHistory(cube);
    }
  }
  return {
    visibility,
    temporal,
    reset: () => {
      previous.clear();
    },
    update: (activeCount: number) => {
      if (disposed) {
        return;
      }
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection, THREE.WebGLCoordinateSystem);
      prepareCanvas(context, canvas, debugView !== "none");
      bounds.length = 0;
      tested = activeCount;
      visible = 0;
      rigid = 0;
      for (let index = 0; index < activeCount; index += 1) {
        const cube = cubes[index];
        if (cube) {
          updateCube(cube);
        }
      }
      temporalCanvas.dataset.valid = String(rigid);
      overlay.render(
        debugBounds
          ? {
              bounds,
              omitted: Math.max(0, activeCount - bounds.length),
              viewProjection: viewProjection.elements,
              clipDepth: "minus-one-to-one",
            }
          : null,
      );
    },
    dispose: () => {
      disposed = true;
      previous.clear();
      overlay.dispose();
      temporalCanvas.remove();
    },
  };
}

function prepareCanvas(
  context: CanvasRenderingContext2D,
  target: HTMLCanvasElement,
  visible: boolean,
): void {
  const canvas = context.canvas;
  canvas.style.display = visible ? "block" : "none";
  if (!visible) {
    return;
  }
  const rect = target.getBoundingClientRect();
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
}
function drawMotion(
  context: CanvasRenderingContext2D,
  sample: {
    current: THREE.Vector3;
    previous: THREE.Vector3 | undefined;
    valid: boolean;
    view: TemporalSnapshot["debugView"];
  },
): void {
  const { current, previous, valid, view } = sample;
  if (
    ![current.x, current.y, current.z].every(Number.isFinite) ||
    current.z < -1 ||
    current.z > 1
  ) {
    return;
  }
  const width = context.canvas.width;
  const height = context.canvas.height;
  const x = ((current.x + 1) * width) / 2;
  const y = ((1 - current.y) * height) / 2;
  if (view === "history") {
    context.fillStyle = valid ? "#75efbb" : "#ff6428";
    context.fillRect(x - 3, y - 3, 6, 6);
  } else if (valid && previous) {
    context.strokeStyle = "#75efbb";
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(
      x + (current.x - previous.x) * width * 6,
      y - (current.y - previous.y) * height * 6,
    );
    context.stroke();
  }
}
