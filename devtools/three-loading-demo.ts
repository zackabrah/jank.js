import {
  FileLoader,
  IcosahedronGeometry,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { observeThreeLoading } from "../src/adapters/three-loading.ts";

/** Explicit preparation on the existing renderer; never warms the stress scene on startup. */
export function createThreeLoadingDemo(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer | WebGPURenderer,
) {
  const manager = new LoadingManager();
  const observer = observeThreeLoading(manager);
  let loaded: Mesh<IcosahedronGeometry, MeshStandardMaterial> | null = null;
  let active: { cancel: (failure?: string) => void; done: Promise<string> } | null = null;
  let disposed = false;
  let attempts = 0;
  let phase = "No asset preparation requested";
  const release = (mesh: Mesh<IcosahedronGeometry, MeshStandardMaterial> | null) => {
    mesh?.removeFromParent();
    mesh?.geometry.dispose();
    mesh?.material.dispose();
  };
  return {
    read: observer.read,
    get phase() {
      return phase;
    },
    async load(missing = false): Promise<string> {
      if (disposed || active)
        throw new Error("Loading is unavailable until the current preparation finishes");
      const abort = new AbortController();
      const run = observer.start({
        label: "Load and prepare sample asset (existing renderer)",
        kind: attempts++ ? "repeat-session" : "editor",
      });
      const loaders: FileLoader[] = [];
      let candidate: Mesh<IcosahedronGeometry, MeshStandardMaterial> | null = null;
      phase = "Loading two assets";
      let failureReason: string | null = null;
      const cancel = (failure?: string) => {
        if (abort.signal.aborted) return;
        failureReason = failure ?? null;
        run.finish(failure ? "failed" : "cancelled", failure);
        abort.abort();
        for (const loader of loaders) loader.abort();
        phase = `${failure ? "Failed" : "Cancelled"}; waiting for in-flight work to settle`;
      };
      const done = (async () => {
        try {
          const load = async (name: string) => {
            const loader = new FileLoader(manager)
              .setResponseType("arraybuffer")
              .setRequestHeader({ Accept: "application/json" });
            loaders.push(loader);
            const value = await loader.loadAsync(`/checks/assets/${name}.json`);
            abort.signal.throwIfAborted();
            if (!(value instanceof ArrayBuffer)) throw new Error("Expected asset bytes");
            run.bytes("assets", value.byteLength);
            return value;
          };
          const results = await Promise.allSettled([
            load("loading-geometry"),
            load(missing ? "loading-missing" : "loading-material"),
          ]);
          abort.signal.throwIfAborted();
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          const geometryBytes = results[0];
          const materialBytes = results[1];
          if (geometryBytes?.status !== "fulfilled" || materialBytes?.status !== "fulfilled")
            throw new Error("Asset load did not complete");
          candidate = await run.measure("decode + scene preparation", () => {
            const geometry: unknown = JSON.parse(new TextDecoder().decode(geometryBytes.value));
            const material: unknown = JSON.parse(new TextDecoder().decode(materialBytes.value));
            if (
              !geometry ||
              typeof geometry !== "object" ||
              !("radius" in geometry) ||
              !("detail" in geometry) ||
              typeof geometry.radius !== "number" ||
              !Number.isFinite(geometry.radius) ||
              geometry.radius <= 0 ||
              geometry.radius > 3 ||
              typeof geometry.detail !== "number" ||
              !Number.isInteger(geometry.detail) ||
              geometry.detail < 0 ||
              geometry.detail > 3 ||
              !material ||
              typeof material !== "object" ||
              !("color" in material) ||
              typeof material.color !== "string" ||
              !/^#[\da-f]{6}$/i.test(material.color)
            )
              throw new Error("Invalid sample asset geometry or material");
            const result = new Mesh(
              new IcosahedronGeometry(geometry.radius, geometry.detail),
              new MeshStandardMaterial({
                color: material.color,
                flatShading: true,
                metalness: 0.2,
                roughness: 0.4,
              }),
            );
            result.position.set(0, 4, 0);
            result.updateMatrixWorld();
            return result;
          });
          abort.signal.throwIfAborted();
          phase = "Preparing shaders on the existing renderer";
          const object = candidate;
          await run.measure("compile", async () => {
            if ("isWebGPURenderer" in renderer)
              await renderer.compileAsync(object, camera, scene, (event) => {
                if (event.lengthComputable) run.compileProgress(event.loaded, event.total);
              });
            else await renderer.compileAsync(object, camera, scene);
          });
          abort.signal.throwIfAborted();
          if (disposed) throw new DOMException("Playground disposed", "AbortError");
          run.finish("ready");
          release(loaded);
          loaded = candidate;
          candidate = null;
          scene.add(loaded);
          phase = "Ready · cyan asset added to the scene";
        } catch (error) {
          const cancelled = abort.signal.aborted && !failureReason;
          const message =
            failureReason ?? (error instanceof Error ? error.message : "Asset preparation failed");
          run.finish(cancelled ? "cancelled" : "failed", cancelled ? undefined : message);
          phase = cancelled
            ? "Cancelled · previous asset preserved"
            : "Failed · previous asset preserved; see Loading";
        } finally {
          release(candidate);
          active = null;
        }
        return phase;
      })();
      active = { cancel, done };
      return done;
    },
    cancel() {
      active?.cancel();
    },
    fail(message: string) {
      active?.cancel(message);
    },
    dispose() {
      if (disposed) return Promise.resolve();
      disposed = true;
      active?.cancel();
      observer.dispose();
      release(loaded);
      loaded = null;
      // compileAsync has no cancellation API; its candidate lives until settlement.
      return active?.done.then(() => {}) ?? Promise.resolve();
    },
  };
}
