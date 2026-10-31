export interface ComparisonSettings {
  readonly objects: number;
  readonly cpuMs: number;
  readonly animate: boolean;
  readonly scale: number;
}
export interface ComparisonOptions {
  readonly a: ComparisonSettings;
  readonly b: ComparisonSettings;
  readonly targetFps: number;
  readonly pairs: number;
  readonly warmupMs: number;
  readonly measureMs: number;
  readonly startedAtMs: number;
}
export interface TimingSummary {
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly overBudgetPercent: number;
}
export interface ComparisonTrial {
  readonly pair: number;
  readonly variant: "A" | "B";
  readonly frames: number;
  readonly gpuSamples: number;
  readonly gpuCoverage: number;
  readonly observedMs: number;
  readonly windowCoverage: number;
  readonly cpu: TimingSummary | null;
  readonly gpu: TimingSummary | null;
  readonly frame: TimingSummary | null;
}
export interface ComparisonReport {
  readonly options: ComparisonOptions;
  readonly status: "running" | "complete" | "cancelled";
  readonly reason: string;
  readonly elapsedMs: number;
  readonly trials: readonly ComparisonTrial[];
}
interface Sample {
  readonly frameId: number;
  readonly atMs: number;
  readonly cpuMs: number;
  frameMs: number | null;
  gpuMs: number | null;
}
export const comparisonLimits = {
  drainMs: 500,
  maxFrames: 2048,
  minFrames: 20,
  gpuCoverage: 0.8,
  windowCoverage: 0.8,
} as const;

function bounded(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
function validate(options: ComparisonOptions): void {
  if (
    !Number.isInteger(options.pairs) ||
    !bounded(options.pairs, 2, 6) ||
    !bounded(options.warmupMs, 500, 10000) ||
    !bounded(options.measureMs, 1000, 10000) ||
    !bounded(options.targetFps, 1, 1000) ||
    !Number.isFinite(options.startedAtMs)
  ) {
    throw new RangeError(
      "Use 2–6 pairs, 0.5–10 s warm-up, 1–10 s measurement and a valid Jank budget.",
    );
  }
  for (const settings of [options.a, options.b]) {
    if (
      !Number.isInteger(settings.objects) ||
      !bounded(settings.objects, 16, 256) ||
      !bounded(settings.cpuMs, 0, 6) ||
      !bounded(settings.scale, 0.5, 1) ||
      typeof settings.animate !== "boolean"
    ) {
      throw new RangeError("Invalid scene settings for the bounded demo comparison.");
    }
  }
}

/** Host-owned boundaries seal the preceding measured frame before any trial/configuration switch. */
export function createComparisonRun(input: ComparisonOptions) {
  validate(input);
  const options = { ...input, a: { ...input.a }, b: { ...input.b } };
  const trials: ComparisonTrial[] = [];
  const samples = new Map<number, Sample>();
  let pending: Sample | null = null;
  let index = 0;
  let stage: "warmup" | "measure" | "drain" = "warmup";
  let stageStartedAtMs = options.startedAtMs;
  let nowMs = options.startedAtMs;
  let status: ComparisonReport["status"] = "running";
  let reason = "";
  let severeFrames = 0;
  const durations = {
    warmup: options.warmupMs,
    measure: options.measureMs,
    drain: comparisonLimits.drainMs,
  };
  const plannedMs =
    options.pairs * 2 * (options.warmupMs + options.measureMs + comparisonLimits.drainMs);

  function progress() {
    const pair = Math.floor(index / 2) + 1;
    const aFirst = pair % 2 === 1;
    const variant: "A" | "B" = (index % 2 === 0) === aFirst ? "A" : "B";
    return { index, pair, variant, stage, elapsedMs: nowMs - options.startedAtMs };
  }
  function cancel(message: string): void {
    if (status === "running") {
      status = "cancelled";
      reason = message;
      pending = null;
      samples.clear();
    }
  }
  function seal(atMs: number): void {
    if (!pending) {
      return;
    }
    if (atMs <= stageStartedAtMs + options.measureMs && atMs > pending.atMs) {
      pending.frameMs = atMs - pending.atMs;
    } else {
      samples.delete(pending.frameId);
    }
    pending = null;
  }
  function nextStage(): void {
    if (stage === "warmup") {
      stage = "measure";
    } else if (stage === "measure") {
      stage = "drain";
    } else {
      trials.push(
        summarizeTrial(progress(), [...samples.values()], {
          budgetMs: 1000 / options.targetFps,
          measureMs: options.measureMs,
        }),
      );
      samples.clear();
      index += 1;
      stage = "warmup";
      if (index === options.pairs * 2) {
        status = "complete";
        reason = "Comparison complete. Review variation and coverage before drawing conclusions.";
      }
    }
    stageStartedAtMs = nowMs;
  }
  return {
    running: () => status === "running",
    progress,
    settings: () => ({ ...(progress().variant === "A" ? options.a : options.b) }),
    tick(atMs: number): void {
      if (status !== "running") {
        return;
      }
      // RAF timestamps can precede an event handler that starts a run in the same frame.
      if (atMs < options.startedAtMs) {
        return;
      }
      if (!Number.isFinite(atMs) || atMs < nowMs) {
        cancel("Clock changed; comparison cancelled.");
        return;
      }
      nowMs = atMs;
      seal(atMs);
      if (atMs - options.startedAtMs > plannedMs + 20000) {
        cancel("Time limit reached; incomplete trials excluded.");
        return;
      }
      if (atMs - stageStartedAtMs >= durations[stage]) {
        nextStage();
      }
    },
    frame(frame: Omit<Sample, "frameMs" | "gpuMs">): void {
      if (status !== "running" || stage === "drain") {
        return;
      }
      severeFrames = frame.cpuMs > 100 ? severeFrames + 1 : 0;
      if (severeFrames >= 3) {
        cancel("Three severe CPU frames; comparison stopped.");
        return;
      }
      if (
        stage !== "measure" ||
        frame.frameId < 1 ||
        !bounded(frame.cpuMs, 0, 10000) ||
        samples.has(frame.frameId)
      ) {
        return;
      }
      if (samples.size >= comparisonLimits.maxFrames) {
        cancel("Sample capacity reached; incomplete trial excluded.");
        return;
      }
      pending = { ...frame, frameMs: null, gpuMs: null };
      samples.set(frame.frameId, pending);
    },
    gpu(frameId: number, durationMs: number): void {
      const sample = samples.get(frameId);
      if (
        status === "running" &&
        sample &&
        sample.gpuMs === null &&
        bounded(durationMs, 0, 60000)
      ) {
        sample.gpuMs = durationMs;
      }
    },
    cancel,
    report: (): ComparisonReport => ({
      options: { ...options, a: { ...options.a }, b: { ...options.b } },
      status,
      reason,
      elapsedMs: Math.max(0, nowMs - options.startedAtMs),
      trials: trials.map((trial) => ({
        ...trial,
        cpu: trial.cpu && { ...trial.cpu },
        gpu: trial.gpu && { ...trial.gpu },
        frame: trial.frame && { ...trial.frame },
      })),
    }),
  };
}
export type ComparisonRun = ReturnType<typeof createComparisonRun>;

function timing(values: number[], budgetMs: number): TimingSummary | null {
  if (values.length < comparisonLimits.minFrames) {
    return null;
  }
  values.sort((a, b) => a - b);
  return {
    averageMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95Ms: values[Math.floor((values.length - 1) * 0.95)] ?? 0,
    overBudgetPercent: (values.filter((value) => value > budgetMs).length / values.length) * 100,
  };
}
function summarizeTrial(
  identity: Pick<ComparisonTrial, "pair" | "variant">,
  samples: Sample[],
  window: { budgetMs: number; measureMs: number },
): ComparisonTrial {
  const { budgetMs, measureMs } = window;
  const sealed = samples.filter((sample) => sample.frameMs !== null);
  const gpu = sealed.flatMap((sample) => (sample.gpuMs === null ? [] : [sample.gpuMs]));
  const gpuCoverage = sealed.length === 0 ? 0 : gpu.length / sealed.length;
  const durations = sealed.flatMap((sample) => (sample.frameMs === null ? [] : [sample.frameMs]));
  const observedMs = durations.reduce((sum, duration) => sum + duration, 0);
  const windowCoverage = observedMs / measureMs;
  const enoughTime = windowCoverage >= comparisonLimits.windowCoverage;
  return {
    pair: identity.pair,
    variant: identity.variant,
    frames: sealed.length,
    gpuSamples: gpu.length,
    gpuCoverage,
    observedMs,
    windowCoverage,
    cpu: enoughTime
      ? timing(
          sealed.map((sample) => sample.cpuMs),
          budgetMs,
        )
      : null,
    gpu: enoughTime && gpuCoverage >= comparisonLimits.gpuCoverage ? timing(gpu, budgetMs) : null,
    frame: enoughTime ? timing(durations, budgetMs + Math.max(1, budgetMs * 0.05)) : null,
  };
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return ((sorted[middle] ?? 0) + (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0)) / 2;
}
function compareMetric(report: ComparisonReport, metric: "cpu" | "gpu" | "frame") {
  const a = report.trials.filter((trial) => trial.variant === "A");
  const b = report.trials.filter((trial) => trial.variant === "B");
  if (
    report.status !== "complete" ||
    a.length !== report.options.pairs ||
    b.length !== a.length ||
    report.trials.some((trial) => trial[metric] === null)
  ) {
    return null;
  }
  const aValues = a.map((trial) => trial[metric]?.p95Ms ?? 0);
  const bValues = b.map((trial) => trial[metric]?.p95Ms ?? 0);
  const differences = bValues.map((value, index) => value - (aValues[index] ?? 0));
  const aMs = median(aValues);
  const bMs = median(bValues);
  const deltaMs = median(differences);
  return {
    aMs,
    bMs,
    deltaMs,
    deltaPercent: aMs === 0 ? null : (deltaMs / aMs) * 100,
    aRangeMs: [Math.min(...aValues), Math.max(...aValues)],
    bRangeMs: [Math.min(...bValues), Math.max(...bValues)],
    pairedDeltaRangeMs: [Math.min(...differences), Math.max(...differences)],
  };
}
/** Compare per-run p95 values with equal trial weight; never pool unequal frame counts. */
export function summarizeComparison(report: ComparisonReport) {
  return {
    cpu: compareMetric(report, "cpu"),
    gpu: compareMetric(report, "gpu"),
    frame: compareMetric(report, "frame"),
  };
}
