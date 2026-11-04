import type { CaptureController } from "../capture/controller.ts";
import { serializeRecording } from "../recording/format.ts";
import { analyzeRecording, LONG_FRAME_EVENT, PRESSURE_EVENT } from "./analyze.ts";

const LONG_FRAME_SCRIPTS = 4;
const LONG_FRAME_MIN_GAP_MS = 250;

declare global {
  interface Window {
    jank?: ReturnType<typeof createAgentApi>;
  }
}

/**
 * Script access to the capture a person drives with Rec, for agents and test harnesses. With
 * `event`, long frames and CPU pressure join a recording it starts, and only then: a person's
 * event list stays their host's own moments.
 */
export function createAgentApi(
  controller: CaptureController,
  options: { event?: (label: string, detail?: string) => void } = {},
) {
  let stopObserving = () => {};
  // The controller lists captures newest first.
  const latest = () => controller.getSnapshot().saved[0];
  const saved = (id?: number) => {
    const { saved: captures } = controller.getSnapshot();
    const capture = id === undefined ? latest() : captures.find((item) => item.id === id);
    if (!capture) throw new Error(id === undefined ? "No saved captures." : `No capture ${id}.`);
    return capture;
  };
  const settled = () =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        const { phase, error } = controller.getSnapshot();
        if (phase === "finalizing") return false;
        if (error) reject(new Error(error));
        else resolve();
        return true;
      };
      if (check()) return;
      const unsubscribe = controller.subscribe(() => {
        if (check()) unsubscribe();
      });
    });
  return {
    version: 1 as const,
    status() {
      const { phase, kind, frames, capacity, elapsedMs, error, blocked, message, saved } =
        controller.getSnapshot();
      return {
        phase,
        kind,
        frames,
        capacity,
        elapsedMs,
        error,
        blocked,
        message,
        captures: saved.map((capture) => ({
          id: capture.id,
          savedAt: capture.savedAt,
          frames: capture.recording.frames.length,
        })),
      };
    },
    start() {
      // Asking the controller would also put this error on the person's panel.
      const current = controller.getSnapshot();
      if (current.phase === "recording" && current.kind === "manual")
        throw new Error("A recording is already running.");
      controller.start();
      const { phase, kind, error, blocked } = controller.getSnapshot();
      if (error || blocked || phase !== "recording" || kind !== "manual")
        throw new Error(error || blocked || `Could not start a recording from ${phase}.`);
      stopObserving();
      if (options.event) stopObserving = observeMachine(options.event);
    },
    /** Resolves once GPU results are in, with the capture's ID and report. */
    async stop(top?: number) {
      const before = controller.getSnapshot();
      if (before.phase !== "recording") throw new Error("No recording is running.");
      const previous = latest()?.id;
      stopObserving();
      stopObserving = () => {};
      controller.stopAndSave();
      await settled();
      const capture = latest();
      if (!capture || capture.id === previous)
        throw new Error(controller.getSnapshot().message || "The recording was not saved.");
      return { id: capture.id, report: analyzeRecording(capture.recording, top) };
    },
    report(id?: number, top?: number) {
      return analyzeRecording(saved(id).recording, top);
    },
    /** The capture's recording as JSON, for jank's viewer or `jank analyze`. */
    export(id?: number) {
      return serializeRecording(saved(id).recording);
    },
  };
}

interface LongFrameScript {
  duration: number;
  invoker?: string;
  sourceFunctionName?: string;
  sourceURL?: string;
}
interface LongFrameEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: readonly LongFrameScript[];
}

const fileOf = (url: string | undefined) => url?.split(/[?#]/)[0]?.split("/").pop() || "";

/** Says what a long frame ran, or that it ran no script, which points outside the page's code. */
export function describeLongFrame(entry: LongFrameEntry) {
  const scripts = [...(entry.scripts ?? [])]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, LONG_FRAME_SCRIPTS)
    .map((script) => {
      const where = [script.sourceFunctionName, fileOf(script.sourceURL)].filter(Boolean);
      return `${where.join(" ") || script.invoker || "script"} ${Math.round(script.duration)} ms`;
    });
  return `${Math.round(entry.duration)} ms from ${Math.round(entry.startTime)} ms; scripts: ${scripts.join(", ") || "none"}`;
}

interface PressureRecord {
  state: string;
}
declare const PressureObserver: {
  new (
    callback: (records: PressureRecord[]) => void,
  ): {
    observe(source: "cpu", options: { sampleInterval: number }): Promise<void>;
    disconnect(): void;
  };
};

/** Notes long frames and CPU pressure as events, where they reach recordings and the viewer. */
function observeMachine(event: (label: string, detail?: string) => void) {
  const stops: (() => void)[] = [];
  if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
    let lastAt = -Infinity;
    const frames = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // A scene that is always slow must not push every other event out of the log.
        if (entry.startTime - lastAt < LONG_FRAME_MIN_GAP_MS) continue;
        lastAt = entry.startTime;
        event(LONG_FRAME_EVENT, describeLongFrame(entry));
      }
    });
    frames.observe({ type: "long-animation-frame" });
    stops.push(() => frames.disconnect());
  }
  if (typeof PressureObserver === "function") {
    let last = "";
    const pressure = new PressureObserver((records) => {
      const state = records.at(-1)?.state;
      if (!state || state === last) return;
      last = state;
      event(PRESSURE_EVENT, state);
    });
    pressure.observe("cpu", { sampleInterval: 1000 }).catch(() => {});
    stops.push(() => pressure.disconnect());
  }
  return () => {
    for (const stop of stops) stop();
  };
}

/** Returns a cleanup that leaves a later host's API in place. */
export function installAgentApi(
  target: Window,
  controller: CaptureController,
  options: { event?: (label: string, detail?: string) => void } = {},
) {
  const api = createAgentApi(controller, options);
  target.jank = api;
  return () => {
    if (target.jank === api) delete target.jank;
  };
}
