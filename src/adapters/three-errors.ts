import type { WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";

export interface RendererIssue {
  label: string;
  detail: string;
  asynchronous: boolean;
}

const bounded = (text: string, length = 1800) =>
  text.length > length ? `${text.slice(0, length - 12)} [truncated]` : text;

function message(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error)
    return typeof error.message === "string" ? error.message : "No error message supplied";
  return "No error message supplied";
}

export function observeWebGlErrors(
  renderer: WebGLRenderer,
  report: (issue: RendererIssue) => void,
) {
  const previous = renderer.debug.onShaderError;
  let active = true;
  const onShaderError: NonNullable<typeof previous> = (gl, program, vertex, fragment) => {
    try {
      if (active) {
        const detail = [
          ["Program", gl.getProgramInfoLog(program)],
          ["Vertex", gl.getShaderInfoLog(vertex)],
          ["Fragment", gl.getShaderInfoLog(fragment)],
        ]
          .map(([stage, log]) => `${stage}: ${bounded(log?.trim() || "No log supplied", 550)}`)
          .join("\n");
        if (!previous) console.error(`WebGL shader error\n${detail}`);
        report({ label: "WebGL shader error", detail, asynchronous: false });
      }
    } finally {
      previous?.call(renderer.debug, gl, program, vertex, fragment);
    }
  };
  renderer.debug.onShaderError = onShaderError;
  return () => {
    active = false;
    if (renderer.debug.onShaderError === onShaderError) renderer.debug.onShaderError = previous;
  };
}

export function observeWebGpuErrors(
  renderer: WebGPURenderer,
  device: GPUDevice,
  report: (issue: RendererIssue) => void,
) {
  let active = true;
  const emit = (label: string, detail: string) => {
    if (active) report({ label, detail: bounded(detail), asynchronous: true });
  };
  const previousError = renderer.onError;
  const previousLoss = renderer.onDeviceLost;
  // r187 supplies an object at runtime, although its published type still says string.
  const onError = function (this: WebGPURenderer, info: unknown) {
    try {
      const type =
        info && typeof info === "object" && "type" in info && typeof info.type === "string"
          ? info.type
          : "GPUError";
      emit("WebGPU backend error", `${type}: ${message(info)}`);
    } finally {
      Reflect.apply(previousError, this, [info]);
    }
  };
  const onDeviceLost: typeof previousLoss = (info) => {
    try {
      emit("WebGPU device lost", `${info.reason || "Unknown reason"}: ${info.message}`);
    } finally {
      previousLoss.call(renderer, info);
    }
  };
  renderer.onError = onError;
  renderer.onDeviceLost = onDeviceLost;

  const pop = device.popErrorScope.bind(device);
  const render = device.createRenderPipelineAsync.bind(device);
  const compute = device.createComputePipelineAsync.bind(device);
  function observe<T>(promise: Promise<T>, label: string, resolved: (value: T) => void) {
    // Keep the original promise/rejection for the host; observer failures cannot replace it.
    void promise.then(resolved, (error: unknown) => emit(label, message(error))).catch(() => {});
    return promise;
  }
  const replacements = {
    popErrorScope() {
      return observe(pop(), "WebGPU error scope failed", (error) => {
        if (error) emit("WebGPU scoped error", `${error.constructor.name}: ${error.message}`);
      });
    },
    createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
      return observe(render(descriptor), "WebGPU render pipeline error", () => {});
    },
    createComputePipelineAsync(descriptor: GPUComputePipelineDescriptor) {
      return observe(compute(descriptor), "WebGPU compute pipeline error", () => {});
    },
  };
  const restore: (() => void)[] = [];
  for (const key of [
    "popErrorScope",
    "createRenderPipelineAsync",
    "createComputePipelineAsync",
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(device, key);
    Object.defineProperty(device, key, {
      value: replacements[key],
      configurable: true,
      writable: true,
    });
    restore.push(() => {
      if (device[key] !== replacements[key]) return;
      if (descriptor) Object.defineProperty(device, key, descriptor);
      else Reflect.deleteProperty(device, key);
    });
  }
  return () => {
    active = false;
    if (renderer.onError === onError) renderer.onError = previousError;
    if (renderer.onDeviceLost === onDeviceLost) renderer.onDeviceLost = previousLoss;
    for (const reset of restore) reset();
  };
}
