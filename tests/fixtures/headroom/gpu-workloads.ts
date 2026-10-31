import * as THREE from "three";
import { type GpuWorkload, gpuWorkloads } from "../../../examples/basic/gpu-workload-options.ts";
import { createGpuProbe } from "../../../examples/basic/gpu-workloads.ts";

/** Hardware evidence uses readback only in this fixture, never in the measured demo loop. */
export function exerciseGpuWorkloads() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(32, 32);
  renderer.info.autoReset = false;
  const hostTarget = new THREE.WebGLRenderTarget(8, 8);
  renderer.setRenderTarget(hostTarget);
  renderer.clear();
  const results = [];
  try {
    for (const mode of Object.keys(gpuWorkloads) as GpuWorkload[]) {
      results.push(exerciseMode(renderer, hostTarget, mode));
    }
    return results;
  } finally {
    hostTarget.dispose();
    renderer.dispose();
  }
}

function exerciseMode(
  renderer: THREE.WebGLRenderer,
  hostTarget: THREE.WebGLRenderTarget,
  mode: GpuWorkload,
) {
  const baselineMemory = { ...renderer.info.memory };
  const targets: NonNullable<Parameters<THREE.WebGLRenderer["setRenderTarget"]>[0]>[] = [];
  const original = renderer.setRenderTarget;
  renderer.setRenderTarget = (target, face, mip) => {
    if (target && target !== hostTarget) {
      targets.push(target);
    }
    original.call(renderer, target, face, mip);
  };
  const probe = createGpuProbe(renderer, mode);
  function pixels() {
    const target = targets.at(-1);
    if (!target) {
      throw new Error("Probe did not render to a target");
    }
    const values = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, values);
    return values;
  }
  try {
    probe.render(1);
    const first = pixels();
    renderer.info.reset();
    probe.render(8);
    const draws = renderer.info.render.calls;
    const next = pixels();
    let differentComponents = 0;
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== next[index]) {
        differentComponents += 1;
      }
    }
    let invalidLoadsRejected = 0;
    for (const count of [0, 0.5, Number.NaN, gpuWorkloads[mode].cap + 1]) {
      try {
        probe.render(count);
      } catch (cause) {
        if (!(cause instanceof RangeError)) {
          throw cause;
        }
        invalidLoadsRejected += 1;
      }
    }
    const restoredTarget = renderer.getRenderTarget() === hostTarget;
    const glError = renderer.getContext().getError();
    const render = renderer.render;
    const failure = new Error("Deliberate failed probe submission");
    let failureRestored = false;
    renderer.render = () => {
      throw failure;
    };
    try {
      probe.render(1);
    } catch (cause) {
      failureRestored = cause === failure && renderer.getRenderTarget() === hostTarget;
    } finally {
      renderer.render = render;
    }
    probe.dispose();
    probe.dispose();
    return {
      mode,
      draws,
      differentComponents,
      invalidLoadsRejected,
      restoredTarget,
      failureRestored,
      glError,
      baselineMemory,
      restoredMemory: { ...renderer.info.memory },
    };
  } finally {
    probe.dispose();
    renderer.setRenderTarget = original;
  }
}
