import type { InstancedMesh, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";

/** Observes the playground's owned batch, without treating submission as pixel visibility. */
export function observeThreeInstances(
  mesh: InstancedMesh,
  info: WebGLRenderer["info"] | WebGPURenderer["info"],
) {
  const drawCalls = () => ("drawCalls" in info.render ? info.render.drawCalls : info.render.calls);
  const previousBefore = mesh.onBeforeRender;
  const previousAfter = mesh.onAfterRender;
  let active = false;
  let before = 0;
  let count = 0;
  let draws = 0;
  let submitted = 0;
  let unique = 0;
  let reliable = true;
  const onBeforeRender: typeof mesh.onBeforeRender = (...args) => {
    previousBefore.apply(mesh, args);
    if (!active) return;
    before = drawCalls();
    count = mesh.count;
  };
  const onAfterRender: typeof mesh.onAfterRender = (...args) => {
    try {
      if (active) {
        const delta = drawCalls() - before;
        if (delta === 1 && count > 0) {
          draws++;
          submitted += count;
          unique = Math.max(unique, count);
        } else if (delta !== 0) {
          // shortcut: this batch uses one opaque draw; evaluate other pipelines before counting them.
          reliable = false;
        }
      }
    } finally {
      previousAfter.apply(mesh, args);
    }
  };
  mesh.onBeforeRender = onBeforeRender;
  mesh.onAfterRender = onAfterRender;
  return {
    beginFrame() {
      active = true;
      draws = submitted = unique = 0;
      reliable = true;
    },
    read(configuredInstances: number) {
      active = false;
      return {
        configuredInstances,
        activeInstances: mesh.count,
        instanceCapacity: mesh.instanceMatrix.count,
        meshVisible: mesh.visible,
        frustumCullingEnabled: mesh.frustumCulled,
        instanceDrawCalls: reliable ? draws : null,
        uniqueSubmittedInstances: reliable ? unique : null,
        submittedInstances: reliable ? submitted : null,
        visibleInstances: null,
      };
    },
    dispose() {
      active = false;
      if (mesh.onBeforeRender === onBeforeRender) mesh.onBeforeRender = previousBefore;
      if (mesh.onAfterRender === onAfterRender) mesh.onAfterRender = previousAfter;
    },
  };
}
