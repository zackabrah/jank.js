import type { TimestampDevice } from "../../../packages/jank/src/adapters/webgpu-readback.ts";

interface ObservedPass {
  readonly type: "compute" | "render";
  readonly writes: GPURenderPassTimestampWrites;
}

/** Test-only observer installed before Jank. Resolves the same queries through separate buffers. */
export function observeGpuDevice(device: TimestampDevice) {
  const createEncoder = device.createCommandEncoder;
  const createBuffer = device.createBuffer;
  const createQuerySet = device.createQuerySet;
  const buffers = new Set<GPUBuffer>();
  const queries = new Set<GPUQuerySet>();
  let createdBuffers = 0;
  let createdQueries = 0;
  let observed: ObservedPass[] | null = null;
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer.call(device, descriptor);
    if (descriptor.label?.startsWith("jank ")) {
      buffers.add(buffer);
      createdBuffers += 1;
      const destroy = buffer.destroy;
      buffer.destroy = () => {
        buffers.delete(buffer);
        destroy.call(buffer);
      };
    }
    return buffer;
  };
  device.createQuerySet = (descriptor) => {
    const query = createQuerySet.call(device, descriptor);
    if (descriptor.label?.startsWith("jank ")) {
      queries.add(query);
      createdQueries += 1;
      const destroy = query.destroy;
      query.destroy = () => {
        queries.delete(query);
        destroy.call(query);
      };
    }
    return query;
  };
  device.createCommandEncoder = (descriptor) => {
    const encoder = createEncoder.call(device, descriptor);
    const render = encoder.beginRenderPass;
    const compute = encoder.beginComputePass;
    encoder.beginRenderPass = (pass) => {
      if (pass.timestampWrites) {
        observed?.push({ type: "render", writes: pass.timestampWrites });
      }
      return render.call(encoder, pass);
    };
    encoder.beginComputePass = (pass) => {
      if (pass?.timestampWrites) {
        observed?.push({ type: "compute", writes: pass.timestampWrites });
      }
      return compute.call(encoder, pass);
    };
    return encoder;
  };
  async function read() {
    const passes = observed ?? [];
    observed = null;
    if (passes.length === 0) {
      throw new Error("No GPU queries observed");
    }
    const resolved = createBuffer.call(device, { size: passes.length * 256, usage: 0x0204 });
    const mapped = createBuffer.call(device, { size: passes.length * 16, usage: 0x0009 });
    try {
      const encoder = createEncoder.call(device);
      for (const [index, pass] of passes.entries()) {
        const start = pass.writes.beginningOfPassWriteIndex;
        const end = pass.writes.endOfPassWriteIndex;
        if (start === undefined || end !== start + 1) {
          throw new Error("Expected a consecutive start/end pair");
        }
        encoder.resolveQuerySet(pass.writes.querySet, start, 2, resolved, index * 256);
        encoder.copyBufferToBuffer(resolved, index * 256, mapped, index * 16, 16);
      }
      device.queue.submit([encoder.finish()]);
      await mapped.mapAsync(1);
      const timestamps = new BigUint64Array(mapped.getMappedRange());
      return passes.map((pass, index) => ({
        type: pass.type,
        startNs: String(timestamps[index * 2]),
        endNs: String(timestamps[index * 2 + 1]),
      }));
    } finally {
      mapped.destroy();
      resolved.destroy();
    }
  }
  return {
    begin: () => {
      observed = [];
    },
    read,
    resources: () => ({
      liveBuffers: buffers.size,
      liveQueries: queries.size,
      createdBuffers,
      createdQueries,
    }),
  };
}

export type GpuEvidence = ReturnType<typeof observeGpuDevice>;
