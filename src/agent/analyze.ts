import { type ComparisonBundle, settingDifferences } from "../compare/model.ts";
import { comparisonResults } from "../compare/results.ts";
import { type GpuFrame, gpuFrameCoverage, gpuSpan, timedPasses } from "../gpu/model.ts";
import {
  frameCpuMs as cpuOf,
  frameToleranceMs,
  recordingDisplayPace,
} from "../recording/display-pace.ts";
import { summarizeRecording } from "../recording/summary.ts";
import type { DiagnosticFrame, PerformanceRecording } from "../recording/types.ts";

const DEFAULT_TOP = 10;
// One hitch often spans several slow frames with a fast one between them.
const EPISODE_GAP_FRAMES = 3;
// GPU work outlasts its frame, so a stall can follow the frame that submitted the work.
const GPU_LOOKBACK_FRAMES = 5;
const EVENT_WINDOW_MS = 50;
const STALL_CPU_SHARE = 0.5;
// The CPU and GPU run in parallel, so whichever is busier sets how much of a frame is work.
const COUNTER_STEPS = 10;
const TOP_SCOPES = 3;
const TOP_EVENTS = 5;
const TREND_MIN_SAMPLES = 8;
const TREND_MIN_MS = 5000;
const TREND_MIN_MONOTONIC = 0.9;
const TREND_MIN_GROWTH = 0.05;

const EVENT_COST_WINDOW_MS = 100;
const MAX_OCCURRENCES = 8;
export const LONG_FRAME_EVENT = "Long frame";
export const PRESSURE_EVENT = "CPU pressure";
// Not moments in the host's work, so their timing says nothing about what it costs.
const NOT_HOST_MOMENTS = new Set([
  LONG_FRAME_EVENT,
  PRESSURE_EVENT,
  "Recording started",
  "Recording stopped",
]);
const BUSY_PRESSURE = new Set(["serious", "critical"]);

const NOTES = [
  "Findings are observations, not causes. Confirm a cost with a controlled before/after run.",
  "A spike's slow frames are mostly CPU scopes. A stall's slow frames are mostly outside instrumented CPU work.",
  "GPU passes can overlap, so pass times and pass sums are not per-pass costs.",
  "A trend can be warm-up rather than a leak. Check it over a longer run.",
  "machine.busy means the browser reported CPU pressure, so timings may reflect other work on the machine.",
  "gpu.passes are costs only when overlapRatio is at or below 1. Above that, passes run concurrently and their times overlap.",
  "With displayLimited, frame time follows the display, so a frame counts as slow against the larger of typical frame time and the budget, and frame statistics can't show improvements in work.",
];

type Statistic = "median" | "p95" | "over";

const rounded = (value: number) => Number(value.toFixed(2));

/** Nearest rank over ascending values, matching the comparison results. */
const percentile = (sorted: readonly number[], share: number) =>
  rounded(sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? 0);

function spread(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

/** Index ranges of slow frames, merged across short gaps. */
function findEpisodes(frames: readonly DiagnosticFrame[], limitMs: number) {
  const episodes: { first: number; last: number }[] = [];
  frames.forEach((frame, index) => {
    if (frame.interval <= limitMs) return;
    const current = episodes.at(-1);
    if (current && index - current.last <= EPISODE_GAP_FRAMES) current.last = index;
    else episodes.push({ first: index, last: index });
  });
  return episodes;
}

function topScopes(frames: readonly DiagnosticFrame[]) {
  const totals = new Map<string, { system: string; label: string; ms: number }>();
  for (const frame of frames)
    for (const scope of frame.scopes) {
      const key = JSON.stringify([scope.system, scope.label]);
      const total = totals.get(key) ?? { system: scope.system, label: scope.label, ms: 0 };
      total.ms += scope.end - scope.start;
      totals.set(key, total);
    }
  return [...totals.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, TOP_SCOPES)
    .map((scope) => ({ ...scope, ms: rounded(scope.ms) }));
}

const isBytes = (counter: string) => /bytes$/i.test(counter);

const counterValues = (sample: PerformanceRecording["samples"][number]) =>
  sample.systems.flatMap((system) =>
    Object.entries(system.values).flatMap(([counter, value]) =>
      // An ID always grows and says nothing about the host's resources.
      typeof value === "number" && Number.isFinite(value) && !/id$/i.test(counter)
        ? [{ system: system.id, counter, value }]
        : [],
    ),
  );

/** Counters that were holding steady and then changed across the episode. */
function counterSteps(recording: PerformanceRecording, startAt: number, endAt: number) {
  const before = recording.samples.filter((sample) => sample.at <= startAt);
  const prior = before.at(-1);
  const after = recording.samples.find((sample) => sample.at >= endAt);
  if (!prior || !after) return [];
  const read = (sample: PerformanceRecording["samples"][number] | undefined) =>
    new Map(sample ? counterValues(sample).map((c) => [`${c.system}\0${c.counter}`, c.value]) : []);
  const earlier = read(before.at(-2));
  const next = read(after);
  return (
    counterValues(prior)
      .flatMap(({ system, counter, value: from }) => {
        const key = `${system}\0${counter}`;
        const to = next.get(key);
        const held = earlier.get(key);
        return to === undefined || to === from || (held !== undefined && held !== from)
          ? []
          : [
              {
                system,
                counter,
                from,
                to,
                change: Math.abs(to - from) / Math.max(Math.abs(from), 1),
              },
            ];
      })
      // Byte estimates shift with every count and would crowd out clues like shaderStages.
      .sort(
        (a, b) => Number(isBytes(a.counter)) - Number(isBytes(b.counter)) || b.change - a.change,
      )
      .slice(0, COUNTER_STEPS)
      .map(({ change: _change, ...step }) => step)
  );
}

function gpuEvidence(gpuFrames: ReadonlyMap<number, GpuFrame>, firstId: number, lastId: number) {
  let worst: { frame: GpuFrame; span: number } | null = null;
  for (let id = firstId - GPU_LOOKBACK_FRAMES; id <= lastId; id++) {
    const frame = gpuFrames.get(id);
    const span = frame ? gpuSpan(frame) : null;
    if (frame && span !== null && (!worst || span > worst.span)) worst = { frame, span };
  }
  if (!worst) return null;
  const coverage = gpuFrameCoverage(worst.frame);
  return {
    frame: worst.frame.frameId,
    spanMs: rounded(worst.span),
    expected: coverage.expected,
    timed: coverage.timed,
    rejected: coverage.rejected,
    omitted: coverage.omitted,
  };
}

function describeEpisodes(recording: PerformanceRecording, limitMs: number, top: number) {
  const { frames, budget, events } = recording;
  const origin = (frames[0]?.at ?? 0) - (frames[0]?.interval ?? 0);
  const gpuFrames = new Map(recording.gpuTiming?.frames.map((frame) => [frame.frameId, frame]));
  const all = findEpisodes(frames, limitMs).map(({ first, last }) => {
    const span = frames.slice(first, last + 1);
    // Faster frames inside a merged episode would otherwise hide what its slow frames spent.
    const slow = span.filter((frame) => frame.interval > limitMs);
    const overBudgetMs = slow.reduce((sum, frame) => sum + frame.interval - budget.frameMs, 0);
    const slowMs = slow.reduce((sum, frame) => sum + frame.interval, 0);
    const slowCpuMs = slow.reduce((sum, frame) => sum + cpuOf(frame), 0);
    return { span, overBudgetMs, explained: slowCpuMs >= slowMs * STALL_CPU_SHARE };
  });
  const ranked = all.toSorted((a, b) => b.overBudgetMs - a.overBudgetMs);
  const shown = ranked.slice(0, top);
  const hidden = ranked.slice(top);
  return {
    episodes: shown.flatMap(({ span, overBudgetMs, explained }, index) => {
      const firstFrame = span[0];
      const lastFrame = span.at(-1);
      if (!firstFrame || !lastFrame) return [];
      const worst = span.reduce((a, b) => (b.interval > a.interval ? b : a));
      const durationMs = span.reduce((sum, frame) => sum + frame.interval, 0);
      const cpuMs = span.reduce((sum, frame) => sum + cpuOf(frame), 0);
      const startAt = firstFrame.at - firstFrame.interval;
      return [
        {
          rank: index + 1,
          kind: explained ? ("spike" as const) : ("stall" as const),
          firstFrame: firstFrame.id,
          lastFrame: lastFrame.id,
          worstFrame: worst.id,
          frames: span.length,
          startMs: rounded(startAt - origin),
          durationMs: rounded(durationMs),
          worstMs: rounded(worst.interval),
          overBudgetMs: rounded(overBudgetMs),
          cpuMs: rounded(cpuMs),
          unaccountedMs: rounded(Math.max(0, durationMs - cpuMs)),
          scopes: topScopes(span),
          events: events
            .filter(
              (event) =>
                event.at >= startAt - EVENT_WINDOW_MS && event.at <= lastFrame.at + EVENT_WINDOW_MS,
            )
            .slice(0, TOP_EVENTS)
            .map((event) => ({
              label: event.label,
              detail: event.detail,
              offsetMs: rounded(event.at - startAt),
            })),
          gpu: gpuEvidence(gpuFrames, firstFrame.id, lastFrame.id),
          counterSteps: counterSteps(recording, startAt, lastFrame.at),
        },
      ];
    }),
    omitted: {
      episodes: hidden.length,
      overBudgetMs: rounded(hidden.reduce((sum, item) => sum + item.overBudgetMs, 0)),
    },
  };
}

/** Counters rising steadily and still rising at the end of the recording. */
function describeTrends(recording: PerformanceRecording, top: number) {
  const series = new Map<
    string,
    { system: string; counter: string; points: { at: number; value: number }[] }
  >();
  for (const sample of recording.samples)
    for (const { system, counter, value } of counterValues(sample)) {
      const key = `${system}\0${counter}`;
      const entry = series.get(key) ?? { system, counter, points: [] };
      entry.points.push({ at: sample.at, value });
      series.set(key, entry);
    }
  return [...series.values()]
    .flatMap(({ system, counter, points }) => {
      const first = points[0];
      const last = points.at(-1);
      const tail = points.at(-Math.ceil(points.length / 3));
      if (!first || !last || !tail || points.length < TREND_MIN_SAMPLES) return [];
      if (last.at - first.at < TREND_MIN_MS || last.at === tail.at) return [];
      let rising = 0;
      points.slice(1).forEach((point, index) => {
        if (point.value >= (points[index]?.value ?? 0)) rising++;
      });
      const monotonicShare = rising / (points.length - 1);
      const growth = (last.value - first.value) / Math.max(Math.abs(first.value), 1);
      const finalThirdPerSecond = ((last.value - tail.value) * 1000) / (last.at - tail.at);
      if (
        monotonicShare < TREND_MIN_MONOTONIC ||
        growth < TREND_MIN_GROWTH ||
        finalThirdPerSecond <= 0
      )
        return [];
      return [
        {
          system,
          counter,
          first: first.value,
          last: last.value,
          perSecond: rounded(((last.value - first.value) * 1000) / (last.at - first.at)),
          finalThirdPerSecond: rounded(finalThirdPerSecond),
          windowSeconds: rounded((last.at - first.at) / 1000),
          monotonicShare: rounded(monotonicShare),
          relativeRate: finalThirdPerSecond / Math.max(Math.abs(last.value), 1),
        },
      ];
    })
    .sort((a, b) => b.relativeRate - a.relativeRate)
    .slice(0, top)
    .map(({ relativeRate: _relativeRate, ...trend }, index) => ({ rank: index + 1, ...trend }));
}

/** Median time per frame for each pass name, with repeats like a mip chain added together. */
function describePasses(complete: readonly GpuFrame[], top: number) {
  const perFrame = new Map<string, number[]>();
  complete.forEach((frame, index) => {
    for (const pass of frame.invocations) {
      if (pass.state !== "timed" || pass.milliseconds === null) continue;
      // A repeat's trailing number comes from its position in the frame, not from what it is.
      const name = pass.label.replace(/ \d+$/, "");
      const times = perFrame.get(name) ?? Array.from({ length: complete.length }, () => 0);
      times[index] = (times[index] ?? 0) + pass.milliseconds;
      perFrame.set(name, times);
    }
  });
  const passes = [...perFrame].map(([label, times]) => ({
    label,
    medianMs: spread(times).median,
    p95Ms: spread(times).p95,
  }));
  const total = passes.reduce((sum, pass) => sum + pass.medianMs, 0);
  return passes
    .map((pass) => ({ ...pass, share: total ? rounded(pass.medianMs / total) : 0 }))
    .sort((a, b) => b.medianMs - a.medianMs)
    .slice(0, top);
}

/** Median and p95 per frame for each CPU scope, counting frames without it as zero. */
function describeCpuScopes(frames: readonly DiagnosticFrame[], top: number) {
  const perFrame = new Map<string, { system: string; label: string; times: number[] }>();
  frames.forEach((frame, index) => {
    for (const scope of frame.scopes) {
      const key = JSON.stringify([scope.system, scope.label]);
      const entry = perFrame.get(key) ?? {
        system: scope.system,
        label: scope.label,
        times: Array.from({ length: frames.length }, () => 0),
      };
      entry.times[index] = (entry.times[index] ?? 0) + scope.end - scope.start;
      perFrame.set(key, entry);
    }
  });
  return [...perFrame.values()]
    .map(({ system, label, times }) => ({ system, label, ...spread(times) }))
    .sort((a, b) => b.median - a.median)
    .slice(0, top);
}

/** Whether each kind of host event costs time only at first or every time it happens. */
function describeEventCosts(recording: PerformanceRecording, limitMs: number, top: number) {
  const { frames, events } = recording;
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) return [];
  const groups = new Map<string, { label: string; detail: string; worst: number[] }>();
  for (const event of events) {
    if (NOT_HOST_MOMENTS.has(event.label)) continue;
    if (event.at < first.at - first.interval || event.at > last.at) continue;
    const near = frames.filter(
      (frame) =>
        frame.at >= event.at - EVENT_COST_WINDOW_MS && frame.at <= event.at + EVENT_COST_WINDOW_MS,
    );
    const key = JSON.stringify([event.label, event.detail]);
    const group = groups.get(key) ?? { label: event.label, detail: event.detail, worst: [] };
    group.worst.push(Math.max(0, ...near.map((frame) => frame.interval)));
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => Math.max(...group.worst) > limitMs)
    .map(({ label, detail, worst }) => {
      const firstMs = worst[0] ?? 0;
      const repeats = worst.slice(1).toSorted((a, b) => a - b);
      const repeatMedianMs = repeats.length ? percentile(repeats, 0.5) : null;
      const pattern =
        repeatMedianMs === null
          ? ("once" as const)
          : repeatMedianMs > limitMs
            ? ("recurring" as const)
            : firstMs > limitMs
              ? ("first-only" as const)
              : ("occasional" as const);
      return {
        label,
        detail,
        pattern,
        occurrences: worst.length,
        firstMs: rounded(firstMs),
        repeatMedianMs,
        worstMs: worst.slice(0, MAX_OCCURRENCES).map(rounded),
      };
    })
    .sort((a, b) => Math.max(...b.worstMs) - Math.max(...a.worstMs))
    .slice(0, top);
}

/** The worst CPU pressure the browser reported while this recording ran. */
function describeMachine(recording: PerformanceRecording) {
  const { frames, events } = recording;
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) return { cpuPressure: null, busy: false };
  const start = first.at - first.interval;
  const pressure = events.filter((event) => event.label === PRESSURE_EVENT);
  const inside = pressure.filter((event) => event.at >= start && event.at <= last.at);
  const before = pressure.filter((event) => event.at < start).at(-1);
  const states = [...(before ? [before] : []), ...inside].map((event) => event.detail);
  if (!states.length) return { cpuPressure: null, busy: false };
  const order = ["nominal", "fair", "serious", "critical"];
  const worst = states.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a));
  return { cpuPressure: worst, busy: BUSY_PRESSURE.has(worst) };
}

function describeGpu(recording: PerformanceRecording, label: string, top: number) {
  const complete = (recording.gpuTiming?.frames ?? []).filter(
    (frame) => gpuFrameCoverage(frame).completeness === "complete",
  );
  const spans = complete.flatMap((frame) => gpuSpan(frame) ?? []);
  const sums = complete.map((frame) =>
    timedPasses(frame).reduce((sum, pass) => sum + pass.milliseconds, 0),
  );
  if (!spans.length)
    return { coverage: label, spanMs: null, passSumMs: null, overlapRatio: null, passes: [] };
  const spanMs = spread(spans);
  const passSumMs = spread(sums);
  return {
    coverage: label,
    spanMs,
    passSumMs,
    overlapRatio: spanMs.median ? rounded(passSumMs.median / spanMs.median) : null,
    passes: describePasses(complete, top),
  };
}

export function analyzeRecording(recording: PerformanceRecording, top = DEFAULT_TOP) {
  const summary = summarizeRecording(recording);
  const { frames, budget, metadata, overhead } = recording;
  const sorted = frames.map((frame) => frame.interval).sort((a, b) => a - b);
  const cpuMs = frames.length ? spread(frames.map(cpuOf)) : null;
  const gpu = describeGpu(recording, summary.gpuLabel, top);
  const pace = recordingDisplayPace(recording);
  const displayLimited = pace !== null;
  const limitMs = pace?.limitMs ?? budget.frameMs + frameToleranceMs(budget.frameMs);
  const slowFrames = frames.filter((frame) => frame.interval > limitMs).length;
  const { episodes, omitted } = describeEpisodes(recording, limitMs, top);
  return {
    format: "jank-analysis" as const,
    version: 1 as const,
    kind: "recording" as const,
    summary: {
      application: metadata.application?.name ?? null,
      createdAt: metadata.createdAt,
      frames: frames.length,
      durationMs: rounded(summary.durationMs),
      fps: summary.durationMs ? rounded((frames.length * 1000) / summary.durationMs) : null,
      budgetMs: rounded(budget.frameMs),
      frameMs: frames.length
        ? {
            median: percentile(sorted, 0.5),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            worst: rounded(summary.worst?.interval ?? 0),
            worstFrame: summary.worst?.id ?? null,
          }
        : null,
      displayLimited,
      overBudget: {
        limitMs: rounded(limitMs),
        frames: slowFrames,
        percent: frames.length ? rounded((100 * slowFrames) / frames.length) : 0,
      },
      cpuMs,
      cpuScopes: describeCpuScopes(frames, top),
      gpu,
      overheadMs: rounded(overhead.collection.mean + overhead.refresh.mean),
      machine: describeMachine(recording),
    },
    episodes,
    omitted,
    eventCosts: describeEventCosts(recording, limitMs, top),
    trends: describeTrends(recording, top),
    notes: NOTES,
  };
}

/** How far runs of the same build disagree: the largest gap within either variant. */
export function spreadWithinVariants(
  values: readonly { variant: "A" | "B"; value: number | null | undefined }[],
) {
  const gaps = (["A", "B"] as const).flatMap((variant) => {
    const known = values.flatMap((entry) =>
      entry.variant === variant && typeof entry.value === "number" ? [entry.value] : [],
    );
    return known.length > 1 ? [Math.max(...known) - Math.min(...known)] : [];
  });
  return gaps.length ? rounded(Math.max(...gaps)) : null;
}

function analyzeComparison(bundle: ComparisonBundle) {
  const model = comparisonResults(bundle);
  const trialSummaries = bundle.trials.map((trial) => analyzeRecording(trial.recording, 1).summary);
  const round = (value: number | null) => (value === null ? null : rounded(value));
  return {
    format: "jank-analysis" as const,
    version: 1 as const,
    kind: "comparison" as const,
    status: bundle.status,
    change: bundle.change,
    variants: { A: bundle.variants.A.label, B: bundle.variants.B.label },
    confounds: settingDifferences(bundle.variants, bundle.change),
    plan: bundle.plan,
    displayLimited: model.displayPaced,
    machineBusy: trialSummaries.some((summary) => summary.machine.busy),
    results: model.results.map((result) => {
      const [channel, statistic] = result.id.split("-") as ["CPU" | "GPU" | "Frame", Statistic];
      const noise = spreadWithinVariants(
        model.trials.map((trial) => ({
          variant: trial.variant,
          value: trial.metrics[channel]?.[statistic],
        })),
      );
      return {
        id: result.id,
        unit: result.unit,
        a: round(result.a),
        b: round(result.b),
        delta: round(result.delta),
        range: result.range ? result.range.map(rounded) : null,
        verdict: result.verdict,
        failure: result.failure,
        unavailable: result.unavailable,
        noise,
        // Two runs of one build differed by at least as much as the builds did.
        withinNoise: noise !== null && result.delta !== null && Math.abs(result.delta) <= noise,
      };
    }),
    trials: bundle.trials.map((trial, index) => {
      const summary = trialSummaries[index];
      return {
        pair: trial.pair,
        variant: trial.variant,
        frames: trial.recording.frames.length,
        worstMs: summary?.frameMs?.worst ?? 0,
        slowFrames: summary?.overBudget.frames ?? 0,
        cpuPressure: summary?.machine.cpuPressure ?? null,
      };
    }),
    notes: [
      "A verdict compares medians across pairs. It is a quick estimate, not a significance test.",
      "noise is how far runs of the same build disagreed. Treat a withinNoise result as no evidence either way.",
      "GPU results sum pass times, which can overlap. Read them as direction, not cost.",
    ],
  };
}

export function analyzeDocument(document: PerformanceRecording | ComparisonBundle, top?: number) {
  return document.format === "jank.js-comparison"
    ? analyzeComparison(document)
    : analyzeRecording(document, top);
}
