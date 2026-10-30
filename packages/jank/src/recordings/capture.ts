import type { Recording } from "./recording.ts";

export interface CaptureOptions {
  readonly thresholdMs: number;
  readonly beforeFrames: number;
  readonly afterFrames: number;
  readonly cooldownMs: number;
}

export type CaptureState =
  | { readonly status: "idle" }
  | { readonly status: "manual"; readonly recordedFrames: number }
  | { readonly status: "armed" }
  | {
      readonly status: "collecting";
      readonly triggerFrameId: number;
      readonly remainingFrames: number;
      readonly rearm: boolean;
    }
  | { readonly status: "cooldown"; readonly rearmAtMs: number };

export interface SavedCapture {
  readonly id: number;
  readonly kind: Recording["capture"]["kind"];
  readonly frameCount: number;
  readonly durationMs: number;
  readonly truncated: boolean;
}

/** Capture storage belongs to the profiler and survives panel removal. */
export interface CaptureController {
  getState(): CaptureState;
  /** Current settings remain readable while idle, recording or cooling down. */
  getOptions(): CaptureOptions;
  start(): void;
  stop(): Recording | null;
  arm(options: CaptureOptions): void;
  /** Stops future triggers; an active after-frame window still finishes. */
  disarm(): void;
  recent(): Recording;
  /** Small detached summaries; IDs never repeat during this profiler's lifetime. */
  list(): readonly SavedCapture[];
  /** Copies one retained recording; cleared or evicted IDs return null. */
  read(id: number): Recording | null;
  /** At most ten completed recordings, oldest first, detached from mutable storage. */
  completed(): readonly Recording[];
}
