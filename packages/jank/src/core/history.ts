import type { FrameSample } from "./frames.ts";
import type { CostSummary } from "./snapshot.ts";

const historyCapacity = 600;

/** Owns sealed frames. Only snapshots cross the mutable storage boundary. */
export class FrameHistory {
  private frames: FrameSample[] = [];
  private nextIndex = 0;

  append(frame: FrameSample): void {
    this.frames[this.nextIndex] = frame;
    this.nextIndex = (this.nextIndex + 1) % historyCapacity;
  }

  snapshot(): FrameSample[] {
    const ordered =
      this.frames.length < historyCapacity
        ? this.frames
        : [...this.frames.slice(this.nextIndex), ...this.frames.slice(0, this.nextIndex)];
    return ordered.map((frame) => ({
      ...frame,
      cpu: { ...frame.cpu },
      scopes: frame.scopes.map((scope) => ({ ...scope })),
      coverage: { ...frame.coverage },
      overhead: { ...frame.overhead },
    }));
  }

  clear(): void {
    this.frames = [];
    this.nextIndex = 0;
  }
}

export function summarizeCost(
  frames: readonly FrameSample[],
  kind: "collectionMs" | "refreshMs",
): CostSummary {
  let averageMs = 0;
  let peakMs = 0;
  let count = 0;
  for (const frame of frames) {
    count += 1;
    const costMs = frame.overhead[kind];
    averageMs += (costMs - averageMs) / count;
    peakMs = Math.max(peakMs, costMs);
  }
  return { latestMs: frames.at(-1)?.overhead[kind] ?? 0, averageMs, peakMs };
}
