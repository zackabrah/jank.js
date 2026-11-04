import { gpuFrameCoverage } from "../gpu/model.ts";
import { frameToleranceMs, recordingDisplayPace } from "../recording/display-pace.ts";
import { unionDuration } from "../recording/timing.ts";
import { type ComparisonBundle, comparisonSchedule } from "./model.ts";

type Channel = "CPU" | "GPU" | "Frame";
type Statistic = "median" | "p95" | "over";
export type Verdict =
  | "B faster"
  | "B slower"
  | "No observed difference"
  | "Inconclusive"
  | "Display-paced"
  | "Unknown";
export interface Failure {
  trial: number;
  reason: string;
}
interface TrialMetric {
  /** False when the host recorded no timing for this channel in any trial (GPU without a source). */
  recorded: boolean;
  samples: number;
  coverage: number;
  median: number | null;
  p95: number | null;
  over: number | null;
  failure: Failure | null;
}
export interface MetricResult {
  id: string;
  label: string;
  unit: "ms" | "pts";
  a: number | null;
  b: number | null;
  delta: number | null;
  range: readonly [number, number] | null;
  verdict: Verdict;
  failure: Failure | null;
  /** Why the metric has no data at all; a missing source, not a failed trial. */
  unavailable: string | null;
}

/** Nonnegative observations; absent scopes in complete frames contribute known zeros. */
function summarize(values: number[], count = values.length, limit = Infinity) {
  const sorted = values.toSorted((a, b) => a - b);
  const zeros = count - sorted.length;
  const at = (index: number) => (index < zeros ? 0 : (sorted[index - zeros] ?? 0));
  return {
    median: count ? at(Math.floor((count - 1) / 2)) / 2 + at(Math.floor(count / 2)) / 2 : null,
    p95: count ? at(Math.ceil(count * 0.95) - 1) : null,
    over: count ? (100 * values.filter((value) => value > limit).length) / count : null,
  };
}
const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0) / 2 +
        (sorted[Math.floor(sorted.length / 2)] ?? 0) / 2
    : null;
};
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;

function verdict(range: readonly [number, number] | null): Verdict {
  if (!range) return "Unknown";
  if (range[0] > 0) return "B slower";
  if (range[1] < 0) return "B faster";
  return range[0] === 0 && range[1] === 0 ? "No observed difference" : "Inconclusive";
}

/** Accepts a validated bundle; no statistics or decisions are trusted from imported summaries. */
export function comparisonResults(bundle: ComparisonBundle) {
  const scopeNames = new Map<string, { system: string; label: string }>();
  const schedule = comparisonSchedule(bundle.plan.pairs);
  const frameTolerance = frameToleranceMs(bundle.budgetMs);
  // Nothing timed in any trial and no known-idle frame: no timing source, or timing was off. That
  // is an absence to report once, not a coverage failure in every trial. Hosts still send records.
  const gpuRecords = bundle.trials.flatMap((trial) => trial.recording.gpuTiming?.frames ?? []);
  const gpuRecorded = gpuRecords.some((record) => {
    const { timed, completeness } = gpuFrameCoverage(record);
    return timed > 0 || completeness === "complete";
  });
  const gpuAbsence = gpuRecords
    .flatMap((record) => record.invocations)
    .find((pass) => pass.reason)?.reason;
  const trials = schedule.map((planned, index) => {
    const trial = bundle.trials[index];
    const name = `${planned.pair}${planned.variant}`;
    const scopes = new Map<string, number[]>();
    const frames = trial?.recording.frames ?? [];
    const window = trial ? trial.measurementEndMs - trial.measurementStartMs : 0;
    const intervals = frames.map((frame) => ({ start: frame.at - frame.interval, end: frame.at }));
    const pace = trial ? recordingDisplayPace(trial.recording, bundle.budgetMs) : null;
    const frameLimit = pace?.limitMs ?? bundle.budgetMs + frameTolerance;
    const windowCoverage = window ? Math.min(1, unionDuration(intervals) / window) : 0;
    const invalidIntervals = intervals.some(
      (span, i) =>
        span.start < (trial?.measurementStartMs ?? 0) - 1e-6 ||
        span.end > (trial?.measurementEndMs ?? 0) + 1e-6 ||
        (i > 0 && span.start < (intervals[i - 1]?.end ?? 0) - 1e-6),
    );
    const windowFailure: Failure | null = !trial
      ? {
          trial: index,
          reason: `Trial ${name} was not completed; its pair is missing a measurement.`,
        }
      : invalidIntervals
        ? {
            trial: index,
            reason: `Trial ${name} has overlapping or out-of-window frame intervals.`,
          }
        : windowCoverage + 1e-9 < bundle.policy.minCoverage
          ? {
              trial: index,
              reason: `Trial ${name} covers ${percent(windowCoverage)} of its measurement window; ${percent(bundle.policy.minCoverage)} is required.`,
            }
          : null;
    const cpu: number[] = [];
    const gpu: number[] = [];
    const gpuFrames = new Map(
      trial?.recording.gpuTiming?.frames.map((record) => [record.frameId, record]),
    );
    for (const frame of frames) {
      const complete = frame.coverage === "complete" && frame.droppedScopes === 0;
      const groups = new Map<string, typeof frame.scopes>();
      for (const scope of frame.scopes) {
        const key = JSON.stringify([scope.system, scope.label]);
        scopeNames.set(key, { system: scope.system, label: scope.label || scope.system });
        if (!complete) continue;
        const group = groups.get(key) ?? [];
        group.push(scope);
        groups.set(key, group);
      }
      if (complete) {
        cpu.push(unionDuration(frame.scopes));
        for (const [key, group] of groups) {
          const values = scopes.get(key) ?? [];
          values.push(unionDuration(group));
          scopes.set(key, values);
        }
      }
      const record = gpuFrames.get(frame.id);
      if (record && gpuFrameCoverage(record).completeness === "complete") {
        const total = record.invocations.reduce((sum, pass) => sum + (pass.milliseconds ?? 0), 0);
        if (Number.isFinite(total)) gpu.push(total);
      }
    }
    const read = (channel: Channel, values: number[]): TrialMetric => {
      if (channel === "GPU" && !gpuRecorded)
        return {
          recorded: false,
          samples: 0,
          coverage: 0,
          median: null,
          p95: null,
          over: null,
          failure: null,
        };
      const coverage =
        channel === "Frame" ? windowCoverage : frames.length ? values.length / frames.length : 0;
      const failure =
        windowFailure ??
        (coverage + 1e-9 < bundle.policy.minCoverage
          ? {
              trial: index,
              reason: `Trial ${name} has ${percent(coverage)} ${channel} coverage (${values.length}/${frames.length}); ${percent(bundle.policy.minCoverage)} is required.`,
            }
          : values.length < bundle.policy.minSamples
            ? {
                trial: index,
                reason: `Trial ${name} has ${values.length} ${channel} samples; ${bundle.policy.minSamples} are required.`,
              }
            : null);
      return {
        recorded: true,
        samples: values.length,
        coverage,
        ...summarize(values, values.length, channel === "Frame" ? frameLimit : bundle.budgetMs),
        failure,
      };
    };
    return {
      ...planned,
      name,
      index,
      recorded: !!trial,
      frames: frames.length,
      displayPaced: pace !== null,
      frameLimit,
      windowCoverage,
      scopes,
      metrics: {
        CPU: read("CPU", cpu),
        GPU: read("GPU", gpu),
        Frame: read(
          "Frame",
          frames.map((frame) => frame.interval),
        ),
      },
    };
  });
  const displayPaced = trials.every((trial) => trial.displayPaced);
  // A median at the display's pace says nothing about the work. A p95 past the slow-frame limit
  // is a real hitch rate, so it keeps its verdict.
  const setByDisplay = (id: string) =>
    displayPaced &&
    (id === "Frame-median" ||
      (id === "Frame-p95" &&
        trials.every((trial) => (trial.metrics.Frame.p95 ?? Infinity) <= trial.frameLimit)));
  const pairResult = (
    id: string,
    label: string,
    unit: MetricResult["unit"],
    values: (number | null)[],
    failure: Failure | null,
    unavailable: string | null = null,
  ): MetricResult => {
    const a = values.filter((v, i): v is number => trials[i]?.variant === "A" && v !== null);
    const b = values.filter((v, i): v is number => trials[i]?.variant === "B" && v !== null);
    const differences: number[] = [];
    if (!failure)
      for (let pair = 1; pair <= bundle.plan.pairs; pair++) {
        const ai = trials.findIndex((trial) => trial.pair === pair && trial.variant === "A");
        const bi = trials.findIndex((trial) => trial.pair === pair && trial.variant === "B");
        const av = values[ai],
          bv = values[bi];
        if (av !== null && av !== undefined && bv !== null && bv !== undefined)
          differences.push(bv - av);
      }
    const range: readonly [number, number] | null =
      differences.length === bundle.plan.pairs
        ? [Math.min(...differences), Math.max(...differences)]
        : null;
    return {
      id,
      label,
      unit,
      a: median(a),
      b: median(b),
      delta: median(differences),
      range,
      verdict: range && setByDisplay(id) ? "Display-paced" : verdict(range),
      failure,
      unavailable,
    };
  };
  const results: MetricResult[] = [];
  for (const channel of ["CPU", "GPU", "Frame"] as const) {
    const stats: Statistic[] = channel === "GPU" ? ["median", "p95"] : ["median", "p95", "over"];
    for (const statistic of stats)
      results.push(
        pairResult(
          `${channel}-${statistic}`,
          `${channel} ${statistic}`,
          statistic === "over" ? "pts" : "ms",
          trials.map((trial) =>
            trial.metrics[channel].failure ? null : trial.metrics[channel][statistic],
          ),
          trials
            .map((trial) => trial.metrics[channel].failure)
            .find((failure) => failure !== null) ?? null,
          channel === "GPU" && !gpuRecorded
            ? `No GPU timing was recorded: ${gpuAbsence ?? "the host has no timestamp source, or timing was off"}.`
            : null,
        ),
      );
  }
  const scopeFailure =
    trials.map((trial) => trial.metrics.CPU.failure).find((failure) => failure !== null) ?? null;
  const changes = scopeFailure
    ? []
    : [...scopeNames]
        .map(([id, name]) => ({
          ...name,
          ...pairResult(
            id,
            name.label,
            "ms",
            trials.map(
              (trial) => summarize(trial.scopes.get(id) ?? [], trial.metrics.CPU.samples).median,
            ),
            null,
          ),
        }))
        .filter((scope) => scope.delta !== 0 && scope.delta !== null)
        .sort(
          (a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || a.id.localeCompare(b.id),
        );
  const opposingScopes =
    changes.some((scope) => (scope.delta ?? 0) > 0) &&
    changes.some((scope) => (scope.delta ?? 0) < 0);
  return {
    trials,
    results,
    scopes: changes.slice(0, 5),
    scopeCount: changes.length,
    scopeFailure,
    opposingScopes,
    frameTolerance,
    displayPaced,
    gpuRecorded,
    policy: bundle.policy,
  };
}
export type ComparisonResults = ReturnType<typeof comparisonResults>;
