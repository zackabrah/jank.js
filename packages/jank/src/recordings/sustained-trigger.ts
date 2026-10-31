import type { FrameSample } from "../core/frames.ts";

export interface SustainedTrigger {
  readonly durationMs: number;
  readonly startedAtMs: number;
  readonly firstFrameId: number;
  readonly frameCount: number;
}

/** Only contiguous sealed frames count; a budget change starts a new streak. */
export class SustainedTriggerDetector {
  private streak: {
    startedAtMs: number;
    endedAtMs: number;
    firstFrameId: number;
    frameCount: number;
    budgetMs: number;
  } | null = null;

  reset(): void {
    this.streak = null;
  }

  observe(frame: FrameSample, durationMs: number, budgetMs: number): SustainedTrigger | null {
    if (frame.endedAtMs - frame.startedAtMs <= budgetMs) {
      this.reset();
      return null;
    }
    if (
      !this.streak ||
      this.streak.endedAtMs !== frame.startedAtMs ||
      this.streak.budgetMs !== budgetMs
    ) {
      this.streak = {
        startedAtMs: frame.startedAtMs,
        endedAtMs: frame.endedAtMs,
        firstFrameId: frame.id,
        frameCount: 0,
        budgetMs,
      };
    }
    this.streak.endedAtMs = frame.endedAtMs;
    this.streak.frameCount += 1;
    if (frame.endedAtMs - this.streak.startedAtMs < durationMs) {
      return null;
    }
    return {
      durationMs,
      startedAtMs: this.streak.startedAtMs,
      firstFrameId: this.streak.firstFrameId,
      frameCount: this.streak.frameCount,
    };
  }
}
