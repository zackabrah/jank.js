import type { PerformanceRecording } from "../recording/types.ts";
import { type GpuFrame, gpuCoverage, gpuFrameCoverage, validateGpuFrame } from "./model.ts";

/** Host-owned rolling history. Updates replace the same frame, including out-of-order readbacks. */
export function createGpuHistory(capacity = 6000, poll: () => void = () => {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 6000)
    throw new RangeError("GPU history capacity must be 1–6000 frames.");
  const records = new Map<number, GpuFrame>();
  let newest = -1;
  let epoch = -1;
  const read = (ids: readonly number[]) =>
    ids.flatMap((id) => {
      const frame = records.get(id);
      return frame ? [structuredClone(frame)] : [];
    });
  return {
    record(frame: GpuFrame) {
      validateGpuFrame(frame);
      if (frame.epoch < epoch) return;
      if (frame.epoch > epoch) {
        records.clear();
        newest = -1;
        epoch = frame.epoch;
      }
      const previous = newest;
      newest = Math.max(newest, frame.frameId);
      if (frame.frameId <= newest - capacity) return;
      if (newest - previous >= capacity) records.clear();
      else for (let id = previous - capacity + 1; id <= newest - capacity; id++) records.delete(id);
      records.set(frame.frameId, structuredClone(frame));
    },
    read,
    coverage: (ids: readonly number[]) =>
      gpuCoverage(
        ids,
        ids.flatMap((id) => records.get(id) ?? []),
      ),
    /** The CPU window is already owned. Drain only its pending queries for at most 500 ms. */
    async finalize(
      recording: PerformanceRecording,
      signal: AbortSignal,
    ): Promise<NonNullable<PerformanceRecording["gpuTiming"]>> {
      const ids = recording.frames.map((frame) => frame.id);
      const held = new Map(read(ids).map((frame) => [frame.frameId, frame]));
      const captureEpoch = epoch;
      const deadline = performance.now() + 500;
      while (true) {
        signal.throwIfAborted();
        poll();
        const waiting = [...held.values()]
          .filter((frame) => gpuFrameCoverage(frame).pending > 0)
          .map((frame) => frame.frameId);
        if (epoch === captureEpoch)
          for (const frame of read(waiting)) held.set(frame.frameId, frame);
        const pending = [...held.values()].some((frame) => gpuFrameCoverage(frame).pending > 0);
        if (!pending || performance.now() >= deadline || epoch !== captureEpoch) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 16));
      }
      signal.throwIfAborted();
      for (const frame of held.values())
        for (const pass of frame.invocations) {
          if (pass.state !== "pending") continue;
          pass.state = "rejected";
          pass.reason =
            epoch !== captureEpoch
              ? "GPU timing session changed during capture"
              : "GPU readback exceeded the 500 ms finalization deadline";
        }
      return {
        version: 1,
        frames: ids.flatMap((id) => {
          const frame = held.get(id);
          return frame ? [frame] : [];
        }),
      };
    },
  };
}
