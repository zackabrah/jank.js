import { vi } from "vitest";
import type { TimestampDevice } from "../../packages/jank/src/adapters/webgpu-readback.ts";

/** A deterministic GPU transport: submission copies timestamps; map completion is controlled. */
export function webGpuDeviceFixture() {
  const buffers = new Map<GPUBuffer, BigUint64Array<ArrayBuffer>>();
  const queries = new Map<GPUQuerySet, BigUint64Array<ArrayBuffer>>();
  const commands = new Map<GPUCommandBuffer, (() => void)[]>();
  const reads: { buffer: GPUBuffer; resolve(): void; reject(cause: unknown): void }[] = [];
  const descriptors: (GPURenderPassDescriptor | GPUComputePassDescriptor)[] = [];
  const loss = Promise.withResolvers<unknown>();
  let createdBuffers = 0;
  let createdQueries = 0;

  function createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    createdBuffers += 1;
    const data = new BigUint64Array(descriptor.size / 8);
    let mapState: GPUBufferMapState = "unmapped";
    const buffer: GPUBuffer = {
      label: descriptor.label ?? "test",
      size: descriptor.size,
      usage: descriptor.usage,
      get mapState() {
        return mapState;
      },
      mapAsync: () => {
        if (mapState !== "unmapped") {
          return Promise.reject(new Error("Already mapped"));
        }
        mapState = "pending";
        const deferred = Promise.withResolvers<void>();
        reads.push({
          buffer,
          resolve: () => {
            mapState = "mapped";
            deferred.resolve();
          },
          reject: deferred.reject,
        });
        return deferred.promise;
      },
      getMappedRange: (offset = 0, size = descriptor.size) => {
        if (mapState !== "mapped") {
          throw new Error("Buffer is not mapped");
        }
        return data.buffer.slice(offset, offset + size);
      },
      unmap: () => {
        mapState = "unmapped";
      },
      destroy: vi.fn(() => {
        buffers.delete(buffer);
        mapState = "unmapped";
        reads.find((read) => read.buffer === buffer)?.reject(new Error("Buffer destroyed"));
      }),
    };
    buffers.set(buffer, data);
    return buffer;
  }

  const device = {
    lost: loss.promise,
    createBuffer: vi.fn(createBuffer),
    createQuerySet: vi.fn((descriptor: GPUQuerySetDescriptor): GPUQuerySet => {
      createdQueries += 1;
      const query: GPUQuerySet = {
        label: descriptor.label ?? "test",
        count: descriptor.count,
        type: descriptor.type,
        destroy: vi.fn(() => {
          queries.delete(query);
        }),
      };
      queries.set(query, new BigUint64Array(descriptor.count));
      return query;
    }),
    createCommandEncoder: vi.fn(() => {
      const steps: (() => void)[] = [];
      return {
        beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
          descriptors.push(descriptor);
          return {};
        },
        beginComputePass: (descriptor: GPUComputePassDescriptor = {}) => {
          descriptors.push(descriptor);
          return {};
        },
        // biome-ignore lint/complexity/useMaxParams: Native WebGPU requires these five positional arguments; the fixture mirrors that contract.
        resolveQuerySet: (
          query: GPUQuerySet,
          first: number,
          count: number,
          target: GPUBuffer,
          offset: number,
        ) => {
          steps.push(() => {
            const data = queries.get(query);
            if (!data) {
              throw new Error("Query destroyed");
            }
            buffers.get(target)?.set(data.subarray(first, first + count), offset / 8);
          });
        },
        // biome-ignore lint/complexity/useMaxParams: Native WebGPU requires these five positional arguments; the fixture mirrors that contract.
        copyBufferToBuffer: (
          source: GPUBuffer,
          offset: number,
          target: GPUBuffer,
          targetOffset: number,
          size: number,
        ) => {
          steps.push(() => {
            const data = buffers.get(source);
            if (!data) {
              throw new Error("Buffer destroyed");
            }
            buffers
              .get(target)
              ?.set(data.subarray(offset / 8, (offset + size) / 8), targetOffset / 8);
          });
        },
        finish: (): GPUCommandBuffer => {
          const command = { label: "test-command" };
          commands.set(command, steps);
          return command;
        },
      };
    }),
    queue: {
      submit: vi.fn((submitted: Iterable<GPUCommandBuffer>) => {
        for (const command of submitted) {
          for (const step of commands.get(command) ?? []) {
            step();
          }
          commands.delete(command);
        }
      }),
    },
  } satisfies TimestampDevice;
  async function flush(): Promise<void> {
    for (let step = 0; step < 12; step += 1) {
      await Promise.resolve();
    }
  }
  return {
    device,
    reads,
    flush,
    descriptors,
    resolve: async (index = 0) => {
      reads[index]?.resolve();
      await flush();
    },
    reject: async (cause: unknown, index = 0) => {
      reads[index]?.reject(cause);
      await flush();
    },
    lose: async () => {
      loss.resolve({ message: "Device lost" });
      await flush();
    },
    write: (writes: GPURenderPassTimestampWrites, start: bigint, end: bigint) => {
      const data = queries.get(writes.querySet);
      if (
        !data ||
        writes.beginningOfPassWriteIndex === undefined ||
        writes.endOfPassWriteIndex === undefined
      ) {
        throw new Error("Missing timestamp query");
      }
      data[writes.beginningOfPassWriteIndex] = start;
      data[writes.endOfPassWriteIndex] = end;
    },
    resources: () => ({
      buffers: buffers.size,
      queries: queries.size,
      createdBuffers,
      createdQueries,
    }),
  };
}
