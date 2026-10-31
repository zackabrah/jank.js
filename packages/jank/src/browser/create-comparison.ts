import { summarizeComparison, summarizeComparisonTrial } from "../analysis/comparison.ts";
import type {
  Comparison,
  ComparisonContext,
  ComparisonHost,
  ComparisonOptions,
  ComparisonReport,
  ComparisonSnapshot,
  ComparisonTrial,
} from "../comparison/comparison.ts";
import {
  comparisonByteLimit,
  copyComparisonContext,
  selectComparisonWindow,
  validateComparisonOptions,
} from "../comparison/recordings.ts";
import type { GpuFrameResolver } from "../core/gpu.ts";
import type { Profiler } from "../profiler.ts";
import { copyRecording } from "../recordings/copy.ts";
import type { Recording } from "../recordings/recording.ts";
import { finalizeRecording } from "./finalize-recording.ts";

interface Dependencies {
  readonly profiler: Profiler;
  readonly host: ComparisonHost;
  readonly gpuResolver?: GpuFrameResolver;
}
/** One bounded experiment, advanced by the host. No RAF, renderer ownership or private capture stream. */
export function createComparison({ profiler, host, gpuResolver }: Dependencies): Comparison {
  let options: ComparisonOptions = { pairs: 3, warmupMs: 1000, measureMs: 2000 };
  let status: ComparisonSnapshot["status"] = "idle";
  let stage: ComparisonSnapshot["stage"] = "ready";
  let reason = "Configure A and B in the host, then run the comparison.";
  let session: ReturnType<ComparisonHost["begin"]> | null = null;
  let context: ComparisonContext | null = null;
  let trials: ComparisonTrial[] = [];
  let index = 0;
  let targetFps = 60;
  let startedAtMs: number | null = null;
  let stageAtMs = 0;
  let lastAtMs = -Infinity;
  let firstFrameId = -1;
  let ownsCapture = false;
  let generation = 0;
  let retainedBytes = 0;
  let disposed = false;

  function identity() {
    const pair = Math.floor(index / 2) + 1;
    const variant: "A" | "B" = (index % 2 === 0) === (pair % 2 === 1) ? "A" : "B";
    return { pair: Math.min(pair, options.pairs), variant };
  }
  function restore(): void {
    const previous = session;
    session = null;
    try {
      previous?.restore();
    } catch (error) {
      status = "cancelled";
      reason += ` Host restoration failed: ${message(error)}`;
    }
  }
  function cancel(detail = "Stopped by user. Only completed trials are retained."): void {
    if (status !== "running") {
      return;
    }
    generation += 1;
    status = "cancelled";
    reason = detail;
    if (ownsCapture) {
      profiler.capture.stop();
      ownsCapture = false;
    }
    restore();
  }
  function start(input: ComparisonOptions): void {
    if (disposed || status === "running") {
      throw new Error("Comparison is already running or disposed.");
    }
    validateComparisonOptions(input);
    if (profiler.capture.getState().status !== "idle") {
      throw new Error("Stop or disarm the current recording before comparing.");
    }
    // Host begin must either succeed with a restoration handle or leave its state unchanged.
    const nextSession = host.begin();
    session = nextSession;
    options = { ...input };
    targetFps = profiler.snapshot().targetFps;
    status = "running";
    stage = "ready";
    reason = "Comparison running";
    trials = [];
    context = null;
    index = 0;
    startedAtMs = null;
    lastAtMs = -Infinity;
    retainedBytes = 0;
    generation += 1;
  }
  function beginTrial(atMs: number): void {
    context = copyComparisonContext(session?.apply(identity().variant) ?? missingSession());
    stage = "warmup";
    stageAtMs = atMs;
  }
  function acceptTrial(recording: Recording, finalization: string, epoch: number): void {
    if (epoch !== generation || status !== "running" || !context) {
      return;
    }
    const trial: ComparisonTrial = {
      ...identity(),
      context,
      recording,
      finalization,
      ...summarizeComparisonTrial(recording, options.measureMs),
    };
    retainedBytes += new TextEncoder().encode(JSON.stringify(trial)).byteLength;
    // Leave room for metadata/summary in the bounded bundle.
    if (retainedBytes > comparisonByteLimit - 65536) {
      cancel("Comparison storage limit reached; incomplete trial excluded.");
      return;
    }
    trials.push(trial);
    index += 1;
    stage = "ready";
    if (index === options.pairs * 2) {
      status = "complete";
      reason =
        "Comparison complete. Review coverage and paired variation; this is a quick estimate.";
      restore();
    }
  }
  async function finalize(recording: Recording, epoch: number): Promise<void> {
    try {
      if (gpuResolver) {
        const result = await finalizeRecording(recording, gpuResolver, { timeoutMs: 2000 });
        acceptTrial(
          result.recording,
          `${result.status}${result.error ? `: ${result.error}` : ""}`,
          epoch,
        );
      } else {
        acceptTrial(recording, "500 ms host drain; no interval resolver connected", epoch);
      }
    } catch (error) {
      if (epoch === generation) {
        cancel(message(error));
      }
    }
  }
  function nextStage(atMs: number, frameId: number): void {
    if (profiler.snapshot().targetFps !== targetFps) {
      cancel("Jank budget changed; restart the comparison.");
    } else if (stage === "ready") {
      beginTrial(atMs);
    } else if (stage === "warmup") {
      profiler.capture.start();
      ownsCapture = true;
      firstFrameId = frameId;
      stage = "measure";
      stageAtMs = atMs;
    } else if (stage === "measure") {
      stage = "drain";
      stageAtMs = atMs;
    } else {
      const recording = profiler.capture.stop();
      ownsCapture = false;
      stage = "finalize";
      if (!recording) {
        cancel("Capture interrupted; incomplete trial excluded.");
        return;
      }
      const selected = selectComparisonWindow(recording, firstFrameId, options.measureMs);
      // GPU validation/merging runs after the current host callback returns.
      const epoch = generation;
      void Promise.resolve().then(() => finalize(selected, epoch));
    }
  }
  function tick(atMs: number, frameId: number): void {
    if (status !== "running") {
      return;
    }
    try {
      if (!Number.isFinite(atMs) || atMs < lastAtMs || frameId < 0) {
        cancel("Host clock or profiler changed; restart the comparison.");
        return;
      }
      lastAtMs = atMs;
      startedAtMs ??= atMs;
      const problem = session?.check?.();
      if (problem) {
        cancel(problem);
        return;
      }
      const expected = ownsCapture ? "manual" : "idle";
      if (profiler.capture.getState().status !== expected) {
        ownsCapture = false;
        cancel("Capture changed or capacity reached; incomplete trial excluded.");
        return;
      }
      const plannedMs = options.pairs * 2 * (options.warmupMs + options.measureMs + 2500);
      if (atMs - startedAtMs > plannedMs + 20000) {
        cancel("Time limit reached; incomplete trials excluded.");
        return;
      }
      advance(atMs, frameId);
    } catch (error) {
      cancel(message(error));
    }
  }
  function advance(atMs: number, frameId: number): void {
    if (stage === "finalize") {
      return;
    }
    const duration = { ready: 0, warmup: options.warmupMs, measure: options.measureMs, drain: 500 }[
      stage
    ];
    if (stage === "ready" || atMs - stageAtMs >= duration) {
      nextStage(atMs, frameId);
    }
  }
  function snapshot(): ComparisonSnapshot {
    return {
      status,
      stage,
      reason,
      ...identity(),
      options: { ...options },
      targetFps,
      trials: trials.map(({ recording: _recording, ...trial }) => structuredClone(trial)),
      summary: summarizeComparison(trials, options.pairs, status === "complete"),
    };
  }
  function report(): ComparisonReport | null {
    if (status === "idle") {
      return null;
    }
    return {
      ...snapshot(),
      format: "jank.js-comparison",
      version: 1,
      trials: trials.map(({ recording, ...trial }) => ({
        ...structuredClone(trial),
        recording: copyRecording(recording),
      })),
    };
  }
  return {
    isRunning: () => status === "running",
    start,
    tick,
    cancel,
    snapshot,
    report,
    dispose: () => {
      cancel("Comparison disposed.");
      disposed = true;
    },
  };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Comparison host failed.";
}
function missingSession(): never {
  throw new Error("Comparison host session is unavailable.");
}
