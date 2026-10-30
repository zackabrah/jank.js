import type { FrameSample } from "../core/frames.ts";
import type { CaptureController, CaptureOptions, CaptureState, SavedCapture } from "./capture.ts";
import { copyRecording } from "./copy.ts";
import { recordingLimits } from "./limits.ts";
import type { Recording } from "./recording.ts";

interface CaptureDependencies {
  readonly recentFrames: () => readonly FrameSample[];
  readonly requestScopes: () => () => void;
  readonly createRecording: (
    frames: readonly FrameSample[],
    capture: Recording["capture"],
    truncated: boolean,
  ) => Recording;
}

interface AutomaticCapture {
  readonly status: "collecting";
  readonly frames: FrameSample[];
  readonly options: CaptureOptions;
  readonly triggerFrameId: number;
  readonly truncated: boolean;
  remainingFrames: number;
  rearm: boolean;
}

type ActiveCapture =
  | { readonly status: "idle" | "armed" }
  | { readonly status: "manual"; readonly frames: FrameSample[] }
  | { readonly status: "cooldown"; readonly rearmAtMs: number }
  | AutomaticCapture;

export function createCaptureController(dependencies: CaptureDependencies): CaptureSession {
  return new CaptureSession(dependencies);
}

class CaptureSession implements CaptureController {
  private readonly dependencies: CaptureDependencies;
  private state: ActiveCapture = { status: "idle" };
  private options: CaptureOptions = {
    thresholdMs: 50,
    beforeFrames: 120,
    afterFrames: 120,
    cooldownMs: 5000,
  };
  private archive: { readonly summary: SavedCapture; readonly recording: Recording }[] = [];
  private nextCaptureId = 1;
  private releaseScopes: (() => void) | null = null;
  private disposed = false;

  constructor(dependencies: CaptureDependencies) {
    this.dependencies = dependencies;
  }

  getState(): CaptureState {
    const state = this.state;
    if (state.status === "manual") {
      return { status: "manual", recordedFrames: state.frames.length };
    }
    if (state.status === "collecting") {
      return {
        status: "collecting",
        triggerFrameId: state.triggerFrameId,
        remainingFrames: state.remainingFrames,
        rearm: state.rearm,
      };
    }
    return { ...state };
  }

  getOptions(): CaptureOptions {
    return { ...this.options };
  }

  start(): void {
    if (this.disposed || this.state.status === "manual") {
      return;
    }
    if (this.state.status === "collecting") {
      this.saveAutomatic(this.state, true);
    }
    this.state = { status: "manual", frames: [] };
    this.updateDemand();
  }

  stop(): Recording | null {
    if (this.state.status !== "manual") {
      return null;
    }
    const recording = this.save(this.state.frames, { kind: "manual" }, false);
    this.state = { status: "idle" };
    this.updateDemand();
    return copyRecording(recording);
  }

  arm(options: CaptureOptions): void {
    if (this.disposed) {
      return;
    }
    validateOptions(options);
    if (this.state.status === "manual") {
      throw new Error("Stop manual recording before arming automatic capture");
    }
    this.options = { ...options };
    if (this.state.status === "collecting") {
      this.state.rearm = true;
    } else if (this.state.status !== "cooldown") {
      this.state = { status: "armed" };
    }
    this.updateDemand();
  }

  disarm(): void {
    if (this.state.status === "collecting") {
      this.state.rearm = false;
    } else if (this.state.status === "armed" || this.state.status === "cooldown") {
      this.state = { status: "idle" };
    }
    this.updateDemand();
  }

  /** Called once for each immutable sealed frame, after it enters recent history. */
  accept(frame: FrameSample): void {
    if (this.disposed) {
      return;
    }
    const state = this.state;
    if (state.status === "manual") {
      if (state.frames.length < recordingLimits.frames) {
        state.frames.push(frame);
      }
      if (state.frames.length === recordingLimits.frames) {
        this.save(state.frames, { kind: "manual" }, true);
        this.state = { status: "idle" };
        this.updateDemand();
      }
      return;
    }
    if (state.status === "collecting") {
      this.acceptAfterFrame(state, frame);
      return;
    }
    if (state.status === "cooldown" && frame.endedAtMs >= state.rearmAtMs) {
      this.state = { status: "armed" };
    }
    if (
      this.state.status === "armed" &&
      frame.endedAtMs - frame.startedAtMs > this.options.thresholdMs
    ) {
      this.trigger(frame);
    }
  }

  private trigger(frame: FrameSample): void {
    const previous = this.dependencies.recentFrames().filter((sample) => sample.id < frame.id);
    const before = previous.slice(Math.max(0, previous.length - this.options.beforeFrames));
    const state: AutomaticCapture = {
      status: "collecting",
      frames: [...before, frame],
      options: { ...this.options },
      triggerFrameId: frame.id,
      remainingFrames: this.options.afterFrames,
      rearm: true,
      truncated: before.length < this.options.beforeFrames,
    };
    this.state = state;
    if (state.remainingFrames === 0) {
      this.finishAutomatic(state, frame.endedAtMs);
    }
  }

  private acceptAfterFrame(state: AutomaticCapture, frame: FrameSample): void {
    if (state.remainingFrames > 0) {
      state.frames.push(frame);
      state.remainingFrames -= 1;
    }
    if (state.remainingFrames === 0) {
      this.finishAutomatic(state, state.frames.at(-1)?.endedAtMs ?? frame.endedAtMs);
    }
  }

  private finishAutomatic(state: AutomaticCapture, endedAtMs: number): void {
    this.saveAutomatic(state, state.truncated);
    this.state = state.rearm
      ? { status: "cooldown", rearmAtMs: endedAtMs + state.options.cooldownMs }
      : { status: "idle" };
    this.updateDemand();
  }

  private saveAutomatic(state: AutomaticCapture, truncated: boolean): Recording {
    return this.save(
      state.frames,
      {
        kind: "automatic",
        triggerFrameId: state.triggerFrameId,
        thresholdMs: state.options.thresholdMs,
        beforeFrames: state.options.beforeFrames,
        afterFrames: state.options.afterFrames,
      },
      truncated,
    );
  }

  private save(
    frames: readonly FrameSample[],
    capture: Recording["capture"],
    truncated: boolean,
  ): Recording {
    const recording = copyRecording(this.dependencies.createRecording(frames, capture, truncated));
    this.archive.push({
      recording,
      summary: {
        id: this.nextCaptureId++,
        kind: recording.capture.kind,
        frameCount: recording.frames.length,
        durationMs:
          (recording.frames.at(-1)?.endedAtMs ?? 0) - (recording.frames[0]?.startedAtMs ?? 0),
        truncated: recording.truncated,
      },
    });
    if (this.archive.length > recordingLimits.archive) {
      this.archive.shift();
    }
    return recording;
  }

  private updateDemand(): void {
    if (this.state.status !== "idle" && this.releaseScopes === null) {
      this.releaseScopes = this.dependencies.requestScopes();
    } else if (this.state.status === "idle" && this.releaseScopes !== null) {
      this.releaseScopes();
      this.releaseScopes = null;
    }
  }

  recent(): Recording {
    const frames = this.disposed ? [] : this.dependencies.recentFrames();
    return copyRecording(this.dependencies.createRecording(frames, { kind: "recent" }, false));
  }

  completed(): readonly Recording[] {
    return this.archive.map((entry) => copyRecording(entry.recording));
  }

  list(): readonly SavedCapture[] {
    return this.archive.map((entry) => ({ ...entry.summary }));
  }

  read(id: number): Recording | null {
    const entry = this.archive.find((entry) => entry.summary.id === id);
    return entry ? copyRecording(entry.recording) : null;
  }

  clear(): void {
    this.state = { status: "idle" };
    this.archive = [];
    this.updateDemand();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}

function validateOptions(options: CaptureOptions): void {
  if (
    !Number.isFinite(options.thresholdMs) ||
    options.thresholdMs <= 0 ||
    !Number.isFinite(options.cooldownMs) ||
    options.cooldownMs < 0
  ) {
    throw new RangeError(
      "Capture threshold must be finite and positive; cooldown must be finite and nonnegative",
    );
  }
  if (
    !Number.isInteger(options.beforeFrames) ||
    options.beforeFrames < 0 ||
    options.beforeFrames > recordingLimits.beforeFrames
  ) {
    throw new RangeError("Before window must contain 0–599 frames");
  }
  if (
    !Number.isInteger(options.afterFrames) ||
    options.afterFrames < 0 ||
    options.afterFrames > recordingLimits.afterFrames
  ) {
    throw new RangeError("After window must contain 0–5400 frames");
  }
}
