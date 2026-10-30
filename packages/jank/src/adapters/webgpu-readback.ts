/** Narrow device boundary; native WebGPU satisfies it without a Three dependency. */
export interface TimestampDevice {
  readonly lost: PromiseLike<unknown>;
  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): {
    beginRenderPass(descriptor: GPURenderPassDescriptor): unknown;
    beginComputePass(descriptor?: GPUComputePassDescriptor): unknown;
    resolveQuerySet(
      query: GPUQuerySet,
      first: number,
      count: number,
      target: GPUBuffer,
      offset: number,
    ): void;
    copyBufferToBuffer(
      source: GPUBuffer,
      offset: number,
      target: GPUBuffer,
      targetOffset: number,
      size: number,
    ): void;
    finish(): GPUCommandBuffer;
  };
  readonly queue: { submit(commands: Iterable<GPUCommandBuffer>): void };
}

export interface TimestampSlot {
  readonly querySet: GPUQuerySet;
  readonly disposed: boolean;
  read(passCount: number, timeoutMs: number): Promise<BigUint64Array<ArrayBuffer>>;
  dispose(): void;
}

export class TimestampReadError extends Error {
  readonly reason: "readback-error" | "readback-timeout";
  constructor(reason: TimestampReadError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/** One slot is reused only after mapping finishes. Disposal also cancels an outstanding map. */
export function createTimestampSlot(device: TimestampDevice, maxPasses: number): TimestampSlot {
  const querySet = device.createQuerySet({
    type: "timestamp",
    count: maxPasses * 2,
    label: "jank timestamps",
  });
  const buffers: GPUBuffer[] = [];
  let disposed = false;
  let cancel: (() => void) | null = null;
  let busy = false;
  let resolved: GPUBuffer;
  let readable: GPUBuffer;
  try {
    // WebGPU flag values: QUERY_RESOLVE | COPY_SRC; COPY_DST | MAP_READ.
    resolved = device.createBuffer({ size: maxPasses * 16, usage: 0x0204, label: "jank resolve" });
    buffers.push(resolved);
    readable = device.createBuffer({ size: maxPasses * 16, usage: 0x0009, label: "jank readback" });
    buffers.push(readable);
  } catch (cause) {
    dispose();
    throw cause;
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    cancel?.();
    querySet.destroy();
    for (const buffer of buffers) {
      buffer.destroy();
    }
  }

  const readSubmitted = async (passCount: number): Promise<BigUint64Array<ArrayBuffer>> => {
    const bytes = passCount * 16;
    const encoder = device.createCommandEncoder();
    encoder.resolveQuerySet(querySet, 0, passCount * 2, resolved, 0);
    encoder.copyBufferToBuffer(resolved, 0, readable, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await readable.mapAsync(0x0001, 0, bytes);
    if (disposed) {
      throw new TimestampReadError("readback-error", "GPU readback cancelled");
    }
    return new BigUint64Array(readable.getMappedRange(0, bytes).slice(0));
  };

  const read = async (
    passCount: number,
    timeoutMs: number,
  ): Promise<BigUint64Array<ArrayBuffer>> => {
    if (disposed || busy) {
      throw new Error("Timestamp slot is unavailable");
    }
    busy = true;
    const stopped = Promise.withResolvers<never>();
    cancel = () =>
      stopped.reject(new TimestampReadError("readback-error", "GPU readback cancelled"));
    const timeout = setTimeout(
      () => stopped.reject(new TimestampReadError("readback-timeout", "GPU readback timed out")),
      timeoutMs,
    );
    try {
      return await Promise.race([readSubmitted(passCount), stopped.promise]);
    } catch (cause) {
      dispose();
      throw cause;
    } finally {
      clearTimeout(timeout);
      cancel = null;
      busy = false;
      if (readable.mapState === "mapped") {
        readable.unmap();
      }
    }
  };
  return {
    querySet,
    get disposed() {
      return disposed;
    },
    read,
    dispose,
  };
}
