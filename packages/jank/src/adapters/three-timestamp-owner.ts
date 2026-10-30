import type { TimestampDevice } from "./webgpu-readback.ts";

type TimestampWriter = (type: unknown, uid: unknown, descriptor: object) => void;
interface TimestampBackend {
  trackTimestamp: boolean;
  initTimestampQuery: TimestampWriter;
  resolveTimestampsAsync: (...args: unknown[]) => Promise<unknown>;
  readonly device: TimestampDevice;
  readonly timestampQueryPool: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTimestampBackend(value: unknown): value is TimestampBackend {
  if (!isObject(value) || value.isWebGPUBackend !== true || !isObject(value.device)) {
    return false;
  }
  const device = value.device;
  const validDevice =
    typeof device.createQuerySet === "function" &&
    typeof device.createBuffer === "function" &&
    typeof device.createCommandEncoder === "function" &&
    isObject(device.queue) &&
    typeof device.queue.submit === "function" &&
    isObject(device.lost) &&
    typeof device.lost.then === "function";
  if (
    !validDevice ||
    typeof value.trackTimestamp !== "boolean" ||
    typeof value.initTimestampQuery !== "function" ||
    typeof value.resolveTimestampsAsync !== "function" ||
    !isObject(value.timestampQueryPool)
  ) {
    return false;
  }
  // Private r186 boundary. The methods are guarded structurally; native return values stay host-owned.
  return true;
}

/** Exclusive timestamp initialization for BOTH pools. Existing Three pools remain untouched. */
export function ownThreeTimestamps(
  backend: TimestampBackend,
  write: TimestampWriter,
  lost: () => void,
) {
  if (
    "jankGpuOwner" in backend.initTimestampQuery ||
    "jankGpuOwner" in backend.device.createCommandEncoder
  ) {
    throw new Error("Jank already owns this renderer/device's GPU timestamp paths");
  }
  if (
    Object.values(backend.timestampQueryPool).some((pool) => isObject(pool) && pool.pendingResolve)
  ) {
    throw new Error("Finish the renderer's pending timestamp resolver before attaching Jank");
  }
  const originalInit = Object.getOwnPropertyDescriptor(backend, "initTimestampQuery");
  const originalResolve = Object.getOwnPropertyDescriptor(backend, "resolveTimestampsAsync");
  const originalTracking = backend.trackTimestamp;
  const originalEncoder = Object.getOwnPropertyDescriptor(backend.device, "createCommandEncoder");
  const createEncoder = backend.device.createCommandEncoder;
  let lastTracking = false;
  const metadata = new WeakMap<object, string>();
  const subscription: { write: TimestampWriter | null } = { write: null };
  let stopWatching: (() => void) | null = null;
  const writer = Object.assign(
    (_type: unknown, uid: unknown, descriptor: object) => {
      Reflect.set(descriptor, "timestampWrites", undefined);
      if (subscription.write && typeof uid === "string") {
        metadata.set(descriptor, uid);
      }
    },
    { jankGpuOwner: true },
  );
  const encoderFactory = Object.assign(
    (descriptor?: GPUCommandEncoderDescriptor) => {
      const encoder = createEncoder.call(backend.device, descriptor);
      wrapPasses(encoder, subscription, metadata);
      return encoder;
    },
    { jankGpuOwner: true },
  );
  const resolver = () =>
    Promise.reject(new Error("Jank owns both timestamp pools; use its frame finalization API"));
  try {
    backend.initTimestampQuery = writer;
    backend.resolveTimestampsAsync = resolver;
    backend.trackTimestamp = false;
    backend.device.createCommandEncoder = encoderFactory;
  } catch (cause) {
    release();
    throw cause;
  }
  stopWatching = watchDeviceLoss(backend.device.lost, lost);
  function restore(
    key: "initTimestampQuery" | "resolveTimestampsAsync",
    installed: unknown,
    original: PropertyDescriptor | undefined,
  ): void {
    if (backend[key] !== installed) {
      return;
    }
    if (original) {
      Object.defineProperty(backend, key, original);
    } else {
      Reflect.deleteProperty(backend, key);
    }
  }
  function release(): void {
    stopWatching?.();
    stopWatching = null;
    subscription.write = null;
    restore("initTimestampQuery", writer, originalInit);
    restore("resolveTimestampsAsync", resolver, originalResolve);
    if (backend.device.createCommandEncoder === encoderFactory) {
      if (originalEncoder) {
        Object.defineProperty(backend.device, "createCommandEncoder", originalEncoder);
      } else {
        Reflect.deleteProperty(backend.device, "createCommandEncoder");
      }
    }
    if (backend.trackTimestamp === lastTracking && backend.trackTimestamp !== originalTracking) {
      backend.trackTimestamp = originalTracking;
    }
  }
  return {
    device: backend.device,
    intact: () =>
      backend.initTimestampQuery === writer &&
      backend.resolveTimestampsAsync === resolver &&
      backend.trackTimestamp === lastTracking &&
      backend.device.createCommandEncoder === encoderFactory,
    enable: (enabled: boolean) => {
      backend.trackTimestamp = enabled;
      lastTracking = enabled;
      subscription.write = enabled ? write : null;
    },
    dispose: release,
  };
}

/** Allocate at each NATIVE pass, including layered rendering and renderer utility passes. */
function wrapPasses(
  encoder: ReturnType<TimestampDevice["createCommandEncoder"]>,
  subscription: { write: TimestampWriter | null },
  metadata: WeakMap<object, string>,
): void {
  const render = encoder.beginRenderPass;
  const compute = encoder.beginComputePass;
  encoder.beginRenderPass = (descriptor) => {
    if (!subscription.write) {
      return render.call(encoder, descriptor);
    }
    // WebGPU reads a dictionary, so inheritance preserves even getters/non-enumerable host fields.
    const timed = Object.create(descriptor) as GPURenderPassDescriptor;
    subscription.write("render", metadata.get(descriptor) ?? "", timed);
    return render.call(encoder, timed);
  };
  encoder.beginComputePass = (descriptor = {}) => {
    if (!subscription.write) {
      return compute.call(encoder, descriptor);
    }
    const timed = Object.create(descriptor) as GPUComputePassDescriptor;
    subscription.write("compute", metadata.get(descriptor) ?? "", timed);
    return compute.call(encoder, timed);
  };
}

/** Keep the uncancellable device promise outside the ownership closure; disposal releases its callback. */
function watchDeviceLoss(lost: PromiseLike<unknown>, notify: () => void): () => void {
  const subscription: { notify: (() => void) | null } = { notify };
  void Promise.resolve(lost).then(
    () => subscription.notify?.(),
    () => subscription.notify?.(),
  );
  return () => {
    subscription.notify = null;
  };
}
