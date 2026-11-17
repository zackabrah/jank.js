import type { WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { expect, test, vi } from "vitest";
import { observeWebGlErrors, observeWebGpuErrors, type RendererIssue } from "./three-errors.ts";

type ShaderProgram = Parameters<NonNullable<WebGLRenderer["debug"]["onShaderError"]>>[1];

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("WebGL includes bounded stage logs, preserves the host callback and restores its hook", () => {
  const issues: RendererIssue[] = [];
  const original = vi.fn(function (this: unknown) {
    expect(this).toBe(renderer.debug);
  });
  const renderer = {
    debug: { checkShaderErrors: false, onShaderError: original },
  } as unknown as WebGLRenderer;
  const gl = {
    getProgramInfoLog: () => "Link failed",
    getShaderInfoLog: (shader: unknown) =>
      shader === vertex ? "Vertex line 3" : "Fragment ".repeat(400),
  } as unknown as WebGLRenderingContext;
  const program = {} as ShaderProgram;
  const vertex = {} as WebGLShader;
  const fragment = {} as WebGLShader;
  const dispose = observeWebGlErrors(renderer, (issue) => issues.push(issue));
  const callback = renderer.debug.onShaderError;
  callback?.(gl, program, vertex, fragment);
  expect(issues[0]).toMatchObject({ label: "WebGL shader error", asynchronous: false });
  expect(issues[0]?.detail).toContain("Program: Link failed\nVertex: Vertex line 3\nFragment:");
  expect(issues[0]?.detail).toContain("[truncated]");
  expect(issues[0]?.detail.length).toBeLessThan(1800);
  expect(original).toHaveBeenCalledWith(gl, program, vertex, fragment);
  expect(renderer.debug.checkShaderErrors).toBe(false);
  dispose();
  dispose();
  expect(renderer.debug.onShaderError).toBe(original);
  callback?.(gl, program, vertex, fragment);
  expect(issues).toHaveLength(1);
});

test("WebGL chains the host callback even if reporting throws and preserves a later replacement", () => {
  const original = vi.fn();
  const renderer = { debug: { onShaderError: original } } as unknown as WebGLRenderer;
  const dispose = observeWebGlErrors(renderer, () => {
    throw new Error("Reporter failed");
  });
  const gl = {
    getProgramInfoLog: () => null,
    getShaderInfoLog: () => null,
  } as unknown as WebGLRenderingContext;
  expect(() =>
    renderer.debug.onShaderError?.(gl, {} as ShaderProgram, {} as WebGLShader, {} as WebGLShader),
  ).toThrow("Reporter failed");
  expect(original).toHaveBeenCalledOnce();
  const replacement = vi.fn();
  renderer.debug.onShaderError = replacement;
  dispose();
  expect(renderer.debug.onShaderError).toBe(replacement);
});

function gpuHarness() {
  const issues: RendererIssue[] = [];
  const hostError = vi.fn(function (this: unknown) {
    expect(this).toBe(renderer);
  });
  const hostLoss = vi.fn(function (this: unknown) {
    expect(this).toBe(renderer);
  });
  const renderer = { onError: hostError, onDeviceLost: hostLoss } as unknown as WebGPURenderer;
  const scope = deferred<GPUError | null>();
  const render = deferred<GPURenderPipeline>();
  const compute = deferred<GPUComputePipeline>();
  const prototype = {
    popErrorScope: vi.fn(function (this: unknown) {
      expect(this).toBe(device);
      return scope.promise;
    }),
    createRenderPipelineAsync: vi.fn(function (this: unknown) {
      expect(this).toBe(device);
      return render.promise;
    }),
    createComputePipelineAsync: vi.fn(function (this: unknown) {
      expect(this).toBe(device);
      return compute.promise;
    }),
  };
  const device = Object.create(prototype) as GPUDevice;
  const dispose = observeWebGpuErrors(renderer, device, (issue) => issues.push(issue));
  return {
    issues,
    renderer,
    device,
    prototype,
    hostError,
    hostLoss,
    scope,
    render,
    compute,
    dispose,
  };
}

test("WebGPU forwards native error objects and device loss without losing host state or new hooks", () => {
  const { renderer, device, issues, hostError, hostLoss, prototype, dispose } = gpuHarness();
  const native = { api: "WebGPU", type: "GPUValidationError", message: "Line 4: bad WGSL" };
  Reflect.apply(renderer.onError, renderer, [native]);
  renderer.onDeviceLost({
    api: "WebGPU",
    reason: "unknown",
    message: "Device reset",
    originalEvent: {},
  });
  expect(hostError).toHaveBeenCalledWith(native);
  expect(hostLoss).toHaveBeenCalledOnce();
  expect(issues).toEqual([
    {
      label: "WebGPU backend error",
      detail: "GPUValidationError: Line 4: bad WGSL",
      asynchronous: true,
    },
    { label: "WebGPU device lost", detail: "unknown: Device reset", asynchronous: true },
  ]);
  const replacement = vi.fn();
  renderer.onError = replacement;
  const laterPop = vi.fn(async () => null);
  device.popErrorScope = laterPop;
  dispose();
  dispose();
  expect(renderer.onError).toBe(replacement);
  expect(renderer.onDeviceLost).toBe(hostLoss);
  expect(device.popErrorScope).toBe(laterPop);
  expect(device.createRenderPipelineAsync).toBe(prototype.createRenderPipelineAsync);
  expect(Object.hasOwn(device, "createRenderPipelineAsync")).toBe(false);
});

test("WebGPU observes scoped errors and pipeline rejection without changing promises or descriptors", async () => {
  const { device, prototype, scope, render, compute, issues, dispose } = gpuHarness();
  const popped = device.popErrorScope();
  const descriptor = { label: "Pipeline under test" } as GPURenderPipelineDescriptor;
  const rendered = device.createRenderPipelineAsync(descriptor);
  const computed = device.createComputePipelineAsync({} as GPUComputePipelineDescriptor);
  expect(popped).toBe(scope.promise);
  expect(rendered).toBe(render.promise);
  expect(computed).toBe(compute.promise);
  expect(prototype.createRenderPipelineAsync).toHaveBeenCalledWith(descriptor);
  const error = { message: "Invalid buffer usage" } as GPUError;
  scope.resolve(error);
  const failure = new Error("Pipeline rejected");
  render.reject(failure);
  const pipeline = {} as GPUComputePipeline;
  compute.resolve(pipeline);
  await expect(popped).resolves.toBe(error);
  await expect(rendered).rejects.toBe(failure);
  await expect(computed).resolves.toBe(pipeline);
  expect(issues.map((issue) => issue.label)).toEqual([
    "WebGPU scoped error",
    "WebGPU render pipeline error",
  ]);
  dispose();
});

test("WebGPU restores own descriptors and ignores late scope/pipeline results after disposal", async () => {
  const { device, renderer, scope, compute, issues, dispose } = gpuHarness();
  const popped = device.popErrorScope();
  const pending = device.createComputePipelineAsync({} as GPUComputePipelineDescriptor);
  dispose();
  const descriptor = {
    value: device.popErrorScope,
    writable: true,
    configurable: true,
    enumerable: false,
  };
  Object.defineProperty(device, "popErrorScope", descriptor);
  const second = observeWebGpuErrors(renderer, device, (issue) => issues.push(issue));
  second();
  expect(Object.getOwnPropertyDescriptor(device, "popErrorScope")).toEqual(descriptor);
  scope.resolve({ message: "Late validation" } as GPUError);
  compute.reject(new Error("Late rejection"));
  await popped;
  await expect(pending).rejects.toThrow("Late rejection");
  expect(issues).toEqual([]);
});

test("WebGPU records compute rejection while successful error scopes stay silent", async () => {
  const { device, scope, compute, issues, dispose } = gpuHarness();
  const popped = device.popErrorScope();
  const pending = device.createComputePipelineAsync({} as GPUComputePipelineDescriptor);
  scope.resolve(null);
  compute.reject(new Error("Invalid compute entry point"));
  await expect(popped).resolves.toBeNull();
  await expect(pending).rejects.toThrow("Invalid compute entry point");
  expect(issues).toEqual([
    {
      label: "WebGPU compute pipeline error",
      detail: "Invalid compute entry point",
      asynchronous: true,
    },
  ]);
  dispose();
});
