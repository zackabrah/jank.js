import { type GpuFrame, type GpuInvocation, MAX_GPU_INVOCATIONS } from "./model.ts";

interface QuerySet {
  destroy(): void;
}
interface ReadBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
interface TimestampDevice<Q, B> {
  features: { has(name: "timestamp-query"): boolean };
  lost: Promise<{ message: string }>;
  createQuerySet(descriptor: { type: "timestamp"; count: number }): Q;
  createBuffer(descriptor: { size: number; usage: number }): B;
}
interface TimestampEncoder<Q, B> {
  resolveQuerySet(set: Q, first: number, count: number, target: B, offset: number): void;
  copyBufferToBuffer(
    source: B,
    sourceOffset: number,
    target: B,
    targetOffset: number,
    size: number,
  ): void;
}

/** Pass-boundary timestamps; the host owns the device, descriptors, submission and frame loop. */
export function createWebGpuSource<Q extends QuerySet, B extends ReadBuffer>(
  device: TimestampDevice<Q, B>,
  onFrame: (frame: GpuFrame) => void,
) {
  type Slot = { set: Q; resolve: B; read: B; used: boolean };
  type Entry = { frame: GpuFrame; slot: Slot | null; passes: GpuInvocation[]; submitted: boolean };
  const supported = device.features.has("timestamp-query");
  const slots: Slot[] = [];
  const queued: Entry[] = [];
  let active: Entry | null = null;
  let enabled = true;
  let disposed = false;
  let lastId = -1;
  const emit = (frame: GpuFrame) => onFrame(structuredClone(frame));
  const reject = (entry: Entry, reason: string) => {
    for (const pass of entry.passes)
      if (pass.state === "pending") {
        pass.state = "rejected";
        pass.reason = reason;
      }
  };
  function slot(): Slot | null {
    const free = slots.find((item) => !item.used);
    if (free) {
      free.used = true;
      return free;
    }
    if (slots.length >= 8) return null;
    const set = device.createQuerySet({ type: "timestamp", count: 64 });
    let resolve: B | null = null;
    try {
      // WebGPU usage bits: QUERY_RESOLVE | COPY_SRC, then COPY_DST | MAP_READ.
      resolve = device.createBuffer({ size: 512, usage: 0x0200 | 0x0004 });
      const read = device.createBuffer({ size: 512, usage: 0x0008 | 0x0001 });
      const created = { set, resolve, read, used: true };
      slots.push(created);
      return created;
    } catch (error) {
      set.destroy();
      resolve?.destroy();
      throw error;
    }
  }
  function dispose(reason = "GPU timing source disposed") {
    if (disposed) return;
    disposed = true;
    if (active) reject(active, reason);
    for (const entry of queued) {
      reject(entry, reason);
      emit(entry.frame);
    }
    queued.length = 0;
    for (const item of slots) {
      item.set.destroy();
      item.resolve.destroy();
      item.read.destroy();
    }
  }
  void device.lost.then((info) => dispose(`WebGPU device lost: ${info.message}`));
  return {
    supported,
    get enabled() {
      return enabled && !disposed;
    },
    beginFrame(frameId: number, inventory: GpuFrame["inventory"] = "unknown") {
      if (disposed || active) throw new Error("GPU source disposed or previous frame still open.");
      if (!Number.isSafeInteger(frameId) || frameId <= lastId)
        throw new Error("GPU frame IDs must increase.");
      lastId = frameId;
      active = {
        frame: {
          frameId,
          source: "webgpu",
          clock: "gpu",
          epoch: 0,
          // Precision is implementation-defined; do not claim the browser actually uses 0.1 ms.
          resolutionMs: null,
          inventory,
          invocations: [],
          omitted: 0,
        },
        slot: null,
        passes: [],
        submitted: false,
      };
    },
    /** Spread this into the actual render/compute pass descriptor; never invent an extra pass. */
    timestampWrites(label: string, kind: GpuInvocation["kind"]) {
      if (!active || disposed) throw new Error("Begin a GPU frame before registering passes.");
      if (!label || label.length > 240)
        throw new Error("GPU pass labels must be 1–240 characters.");
      const { frame } = active;
      if (frame.invocations.length >= MAX_GPU_INVOCATIONS) {
        frame.omitted++;
        return undefined;
      }
      const pass: GpuInvocation = {
        id: String(frame.invocations.length),
        label,
        kind,
        state: "pending",
        milliseconds: null,
        startMs: null,
        endMs: null,
        reason: null,
      };
      frame.invocations.push(pass);
      let reason = !supported
        ? "GPU timestamp queries unsupported"
        : !enabled
          ? "GPU timing disabled"
          : active.passes.length >= 32
            ? "GPU query capacity reached"
            : null;
      if (!reason && !active.slot) {
        try {
          active.slot = slot();
        } catch {
          reason = "GPU query allocation failed";
        }
      }
      if (reason || !active.slot) {
        pass.state = "omitted";
        pass.reason = reason ?? "GPU readback pool full";
        return undefined;
      }
      const index = active.passes.length * 2;
      active.passes.push(pass);
      return {
        querySet: active.slot.set,
        beginningOfPassWriteIndex: index,
        endOfPassWriteIndex: index + 1,
      };
    },
    /** Append query resolution after the frame's passes, before finishing this command encoder. */
    endFrame(encoder: TimestampEncoder<Q, B>) {
      if (!active) throw new Error("No GPU frame is open.");
      const entry = active;
      active = null;
      if (entry.slot && entry.passes.length) {
        const count = entry.passes.length * 2;
        try {
          encoder.resolveQuerySet(entry.slot.set, 0, count, entry.slot.resolve, 0);
          encoder.copyBufferToBuffer(entry.slot.resolve, 0, entry.slot.read, 0, count * 8);
          queued.push(entry);
        } catch (error) {
          reject(entry, "GPU query encoding failed");
          emit(entry.frame);
          dispose("GPU query encoding failed");
          throw error;
        }
      }
      emit(entry.frame);
    },
    /** Call immediately AFTER queue.submit; this starts readback without awaiting it in the loop. */
    readSubmittedFrames() {
      if (disposed) return;
      for (const entry of queued) {
        if (entry.submitted || !entry.slot) continue;
        entry.submitted = true;
        const buffer = entry.slot.read;
        void buffer
          .mapAsync(1)
          .then(() => {
            if (disposed) return;
            const values = new BigUint64Array(buffer.getMappedRange());
            // Encoding order is not GPU order: hosts can encode nested passes inside an open one.
            let origin: bigint | undefined;
            for (let i = 0; i < entry.passes.length; i++) {
              const start = values[i * 2];
              if (start && (origin === undefined || start < origin)) origin = start;
            }
            entry.passes.forEach((pass, i) => {
              if (pass.state !== "pending") return;
              const start = values[i * 2],
                end = values[i * 2 + 1];
              if (
                origin === undefined ||
                start === undefined ||
                end === undefined ||
                end < start ||
                start < origin ||
                end - origin > BigInt(Number.MAX_SAFE_INTEGER)
              ) {
                pass.state = "rejected";
                pass.reason = "GPU timestamp counter reset or invalid result";
              } else {
                // Subtract as bigint before converting, preserving precision for large clock origins.
                pass.milliseconds = Number(end - start) / 1e6;
                pass.startMs = Number(start - origin) / 1e6;
                pass.endMs = Number(end - origin) / 1e6;
                pass.state = "timed";
              }
            });
          })
          .catch(() => {
            reject(entry, "GPU readback failed");
          })
          .finally(() => {
            if (!disposed) {
              buffer.unmap();
              emit(entry.frame);
            }
            if (entry.slot) entry.slot.used = false;
            const index = queued.indexOf(entry);
            if (index >= 0) queued.splice(index, 1);
          });
      }
    },
    setEnabled(value: boolean) {
      if (disposed || enabled === value) return;
      enabled = value;
      if (active) reject(active, "GPU timing changed while a frame was open");
      for (const entry of queued) {
        reject(entry, "GPU timing changed while readback was pending");
        emit(entry.frame);
      }
    },
    dispose: () => dispose(),
  };
}
