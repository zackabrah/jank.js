/** Bounded quick-run decisions; clocks, CPU observations and correlated GPU replies are supplied by the host. */
const headroomLimits = {
  warmupMs: 600,
  measureMs: 1000,
  drainMs: 300,
  deadlineMs: 60000,
  minWindowFrames: 12,
  gpuCoverage: 0.8,
  maxFrames: 2048,
} as const;
export type HeadroomPhase = "baseline" | "cpu" | "gpu" | "scene";
export interface HeadroomLevel {
  readonly phase: HeadroomPhase;
  readonly amount: number;
}
export interface HeadroomFrame {
  readonly frameId: number;
  readonly atMs: number;
  readonly cpuMs: number;
  readonly frameMs: number;
  gpuMs: number | null;
}
export interface HeadroomStep extends HeadroomLevel {
  readonly cpuP95Ms: number | null;
  readonly gpuP95Ms: number | null;
  readonly frameP95Ms: number | null;
  readonly frames: number;
  readonly gpuSamples: number;
  readonly gpuCoverage: number;
  readonly verdict: "within-budget" | "over-budget" | "unstable" | "unmeasured" | "guard";
  readonly limiting: readonly string[];
}
export interface HeadroomOptions {
  readonly targetFps: number;
  readonly objects: number;
  readonly startedAtMs: number;
  readonly gpuSupported: boolean;
}

function percentile(values: readonly number[]): number | null {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.95)] ?? null;
}

function windowMetrics(frames: readonly HeadroomFrame[]) {
  const gpu = frames.flatMap((frame) => (frame.gpuMs === null ? [] : [frame.gpuMs]));
  const coverage = frames.length === 0 ? 0 : gpu.length / frames.length;
  return {
    cpuP95Ms: percentile(frames.map((frame) => frame.cpuMs)),
    gpuP95Ms: coverage >= headroomLimits.gpuCoverage ? percentile(gpu) : null,
    frameP95Ms: percentile(frames.map((frame) => frame.frameMs)),
    frames: frames.length,
    gpuSamples: gpu.length,
    gpuCoverage: coverage,
  };
}

function exceeded(metrics: ReturnType<typeof windowMetrics>, budgetMs: number): string[] {
  const result: string[] = [];
  if ((metrics.cpuP95Ms ?? 0) > budgetMs) {
    result.push("CPU");
  }
  if ((metrics.gpuP95Ms ?? 0) > budgetMs) {
    result.push("GPU");
  }
  // RAF is quantized by presentation; tolerate 1ms or 5%, without relaxing CPU/GPU budgets.
  if ((metrics.frameP95Ms ?? 0) > budgetMs + Math.max(1, budgetMs * 0.05)) {
    result.push("frame pacing");
  }
  return result;
}

export function summarizeStep(
  level: HeadroomLevel,
  frames: readonly HeadroomFrame[],
  budgetMs: number,
): HeadroomStep {
  const metrics = windowMetrics(frames);
  const middle = Math.floor(frames.length / 2);
  const first = windowMetrics(frames.slice(0, middle));
  const second = windowMetrics(frames.slice(middle));
  const enough =
    first.frames >= headroomLimits.minWindowFrames &&
    second.frames >= headroomLimits.minWindowFrames;
  const gpuComplete = first.gpuP95Ms !== null && second.gpuP95Ms !== null;
  const gpuEnough = level.phase !== "gpu" || gpuComplete;
  const firstLimits = exceeded(first, budgetMs);
  const secondLimits = exceeded(second, budgetMs);
  const limiting = firstLimits.filter((limit) => secondLimits.includes(limit));
  let verdict: HeadroomStep["verdict"] = "unmeasured";
  if (enough && gpuEnough) {
    verdict = "within-budget";
    if (limiting.length > 0) {
      verdict = "over-budget";
    } else if (firstLimits.length + secondLimits.length > 0) {
      verdict = "unstable";
    }
  }
  return {
    ...level,
    ...metrics,
    gpuP95Ms: gpuComplete ? metrics.gpuP95Ms : null,
    verdict,
    limiting,
  };
}

/** No timer or renderer ownership: tick once in the existing RAF, frame before polling GPU results. */
export function createHeadroomRun(options: HeadroomOptions) {
  const budgetMs = 1000 / options.targetFps;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError("Headroom requires a positive target FPS");
  }
  const plan: HeadroomLevel[] = [
    { phase: "baseline", amount: options.objects },
    ...Array.from({ length: 11 }, (_, index) => ({ phase: "cpu" as const, amount: 2 ** index })),
    ...Array.from({ length: 10 }, (_, index) => ({ phase: "gpu" as const, amount: 2 ** index })),
    ...[
      ...new Set(
        Array.from({ length: 8 }, (_, index) => Math.min(8192, options.objects * 2 ** (index + 1))),
      ),
    ].map((amount) => ({ phase: "scene" as const, amount })),
  ];
  let index = 0;
  let level = plan[0] ?? { phase: "baseline" as const, amount: options.objects };
  let stageStartedAtMs = options.startedAtMs;
  let status: "running" | "complete" | "cancelled" = "running";
  let reason = "";
  let gpuUsable = options.gpuSupported;
  let severeFrames = 0;
  const samples = new Map<number, HeadroomFrame>();
  const steps: HeadroomStep[] = [];
  const phaseEnds: Partial<Record<HeadroomPhase, string>> = {};
  let nowMs = options.startedAtMs;

  function finishStep(guard = false): void {
    const result = summarizeStep(level, [...samples.values()], budgetMs);
    const step = guard ? { ...result, verdict: "guard" as const } : result;
    steps.push(step);
    if (level.phase === "baseline") {
      gpuUsable = gpuUsable && step.gpuP95Ms !== null;
    }
    const stopPhase = step.verdict !== "within-budget";
    if (stopPhase) {
      phaseEnds[level.phase] = step.verdict;
    }
    if (stopPhase && level.phase === "baseline") {
      status = "complete";
      reason = "Baseline did not establish the target budget; no extra capacity is recommended.";
      return;
    }
    advanceLevel(stopPhase);
  }

  function advanceLevel(skipPhase: boolean): void {
    const previousPhase = level.phase;
    index += 1;
    while (
      plan[index] &&
      ((skipPhase && plan[index]?.phase === previousPhase) ||
        (!gpuUsable && plan[index]?.phase === "gpu"))
    ) {
      index += 1;
    }
    const next = plan[index];
    if (next?.phase !== previousPhase && !phaseEnds[previousPhase]) {
      phaseEnds[previousPhase] = "load cap reached";
    }
    if (!gpuUsable) {
      phaseEnds.gpu = "GPU timestamps unavailable or insufficient";
    }
    if (!next) {
      status = "complete";
      reason =
        "Quick estimate complete. Untested workloads and thermal changes can change these limits.";
      return;
    }
    level = next;
    stageStartedAtMs = nowMs;
    severeFrames = 0;
    samples.clear();
  }

  return {
    running: () => status === "running",
    tick(atMs: number): void {
      if (status !== "running") {
        return;
      }
      nowMs = atMs;
      if (atMs - options.startedAtMs >= headroomLimits.deadlineMs) {
        status = "complete";
        reason = "Quick time limit reached; unfinished limits remain unmeasured.";
      } else if (
        atMs - stageStartedAtMs >=
        headroomLimits.warmupMs + headroomLimits.measureMs + headroomLimits.drainMs
      ) {
        finishStep();
      }
    },
    work() {
      const working =
        status === "running" &&
        nowMs - stageStartedAtMs < headroomLimits.warmupMs + headroomLimits.measureMs;
      return {
        cpuBatches: working && level.phase === "cpu" ? level.amount : 0,
        gpuIterations: working && level.phase === "gpu" ? level.amount : 0,
        objects: working && level.phase === "scene" ? level.amount : options.objects,
      };
    },
    frame(frame: Omit<HeadroomFrame, "gpuMs">): void {
      const ageMs = frame.atMs - stageStartedAtMs;
      if (status !== "running" || ageMs >= headroomLimits.warmupMs + headroomLimits.measureMs) {
        return;
      }
      if (ageMs >= headroomLimits.warmupMs && samples.size < headroomLimits.maxFrames) {
        samples.set(frame.frameId, { ...frame, gpuMs: null });
      }
      severeFrames = frame.cpuMs > 100 || frame.frameMs > 250 ? severeFrames + 1 : 0;
      if (severeFrames >= 3) {
        finishStep(true);
      }
    },
    gpu(frameId: number, durationMs: number): void {
      const sample = samples.get(frameId);
      if (
        status === "running" &&
        sample &&
        sample.gpuMs === null &&
        Number.isFinite(durationMs) &&
        durationMs >= 0
      ) {
        sample.gpuMs = durationMs;
      }
    },
    cancel(message: string): void {
      if (status === "running") {
        status = "cancelled";
        reason = message;
      }
    },
    report() {
      return {
        status,
        reason,
        budgetMs,
        targetFps: options.targetFps,
        level,
        steps: [...steps],
        phaseEnds: { ...phaseEnds },
        elapsedMs: Math.max(0, nowMs - options.startedAtMs),
      };
    },
  };
}
export type HeadroomRun = ReturnType<typeof createHeadroomRun>;
export type HeadroomReport = ReturnType<HeadroomRun["report"]>;
