import { recordingFixture } from "../recording/fixtures.ts";
import type { DiagnosticFrame } from "../recording/types.ts";
import type { CaptureSource } from "./controller.ts";

/** Deterministic reference host for tests and review, never production collection. */
export function captureFixture(capacity = 4) {
  const recording = recordingFixture();
  recording.frameCapacity = capacity;
  recording.capture.beforeFrames = Math.min(120, Math.floor((capacity - 1) / 2));
  recording.capture.afterFrames = Math.min(60, capacity - recording.capture.beforeFrames - 1);
  recording.capture.cooldownMs = 5000;
  const history = [...recording.frames];
  let recorded: DiagnosticFrame[] = [];
  let active = false;
  let armed = false;
  let cooldownUntil = 0;
  const source: CaptureSource = {
    recentFrameCapacity: 180,
    recordingFrameIds: () => recorded.map((frame) => frame.id),
    snapshot: () => ({
      frames: history.slice(-180),
      systems: [],
      budget: recording.budget,
      recording: active,
      recordedFrames: recorded.length,
      capture: { ...recording.capture },
    }),
    startRecording: () => {
      recorded = [];
      active = true;
      recording.capture.mode = "manual";
      recording.capture.state = "recording";
      recording.capture.triggerFrame = null;
    },
    stopRecording: () => {
      active = false;
      recording.capture.state = armed ? "cooldown" : "idle";
    },
    armCapture: (rule) => {
      Object.assign(recording.capture, rule, {
        mode: "recent",
        state: "armed",
        triggerFrame: null,
        remainingFrames: 0,
      });
      armed = true;
      cooldownUntil = 0;
    },
    disarmCapture: () => {
      armed = false;
      if (!active) recording.capture.state = "idle";
    },
    export: () => ({
      ...recording,
      frames: recorded.length ? recorded : history,
      capture: { ...recording.capture },
    }),
  };
  const finish = (at: number) => {
    active = false;
    cooldownUntil = at + recording.capture.cooldownMs;
    recording.capture.state = armed ? "cooldown" : "idle";
    recording.capture.remainingFrames = 0;
  };
  return {
    source,
    advance(count = 1, duration?: number) {
      for (let i = 0; i < count; i++) {
        const last = history.at(-1);
        const interval = duration ?? (history.length % 3 === 1 ? 42 : 16);
        const start = last?.at ?? 0;
        const frame: DiagnosticFrame = {
          id: (last?.id ?? 0) + 1,
          at: start + interval,
          interval,
          update: 2,
          render: 1,
          coverage: "complete",
          droppedScopes: 0,
          overhead: { collectionMs: 0.01, refreshMs: 0.02 },
          scopes: [{ system: "simulation", label: "Simulation", start, end: start + 2 }],
        };
        history.push(frame);
        if (!active && armed && frame.at >= cooldownUntil) {
          recording.capture.state = "armed";
          if (interval > (recording.capture.thresholdMs ?? recording.budget.frameMs * 2)) {
            recorded = history.slice(-(recording.capture.beforeFrames + 1));
            active = true;
            recording.capture.mode = "automatic";
            recording.capture.state = "recording";
            recording.capture.triggerFrame = frame.id;
            recording.capture.remainingFrames = recording.capture.afterFrames;
            if (!recording.capture.afterFrames) finish(frame.at);
          }
        } else if (active) {
          recorded.push(frame);
          if (recording.capture.mode === "automatic") recording.capture.remainingFrames--;
          if (
            recorded.length >= capacity ||
            (recording.capture.mode === "automatic" && recording.capture.remainingFrames === 0)
          )
            finish(frame.at);
        }
      }
    },
  };
}
