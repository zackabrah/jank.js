import { summarizeComparison, summarizeComparisonTrial } from "../analysis/comparison.ts";
import { readRecording } from "../recordings/codec.ts";
import { parseJsonData } from "../recordings/json.ts";
import {
  choice,
  integer,
  invalid,
  list,
  number,
  object,
  RecordingError,
  text,
} from "../recordings/read-values.ts";
import type { Recording, RecordingProblem } from "../recordings/recording.ts";
import type {
  ComparisonContext,
  ComparisonOptions,
  ComparisonReport,
  ComparisonTrial,
} from "./comparison.ts";

export type ComparisonResult =
  | { readonly ok: true; readonly comparison: ComparisonReport }
  | { readonly ok: false; readonly problem: RecordingProblem };

function readContext(value: unknown, path: string): ComparisonContext {
  const data = object(value, path);
  const resolution =
    data.resolution === null ? null : object(data.resolution, `${path}.resolution`);
  return {
    label: text(data.label, `${path}.label`, 256),
    animation: text(data.animation, `${path}.animation`, 256),
    resolution: resolution && {
      widthPx: integer(resolution.widthPx, `${path}.resolution.widthPx`, 1),
      heightPx: integer(resolution.heightPx, `${path}.resolution.heightPx`, 1),
    },
    settings: list(data.settings, `${path}.settings`, 32, (value, path) => {
      const setting = object(value, path);
      return {
        label: text(setting.label, `${path}.label`, 256),
        value: readSetting(setting.value, `${path}.value`),
      };
    }),
  };
}
function readSetting(value: unknown, path: string): string | number | boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return number(value, path, -Number.MAX_VALUE);
  }
  return text(value, path, 256);
}
function readOptions(value: unknown): ComparisonOptions {
  const data = object(value, "$.options");
  return {
    pairs: integer(data.pairs, "$.options.pairs", 2, 6),
    warmupMs: number(data.warmupMs, "$.options.warmupMs", 500, 10000),
    measureMs: number(data.measureMs, "$.options.measureMs", 1000, 10000),
  };
}
function nestedRecording(value: unknown, path: string): Recording {
  try {
    return readRecording(value);
  } catch (error) {
    if (error instanceof RecordingError) {
      throw new RecordingError({ ...error.problem, path: `${path}${error.problem.path.slice(1)}` });
    }
    throw error;
  }
}
/** Authoritative fields are bounded and validated; derived metrics are always recalculated. */
export function readComparison(value: unknown): ComparisonReport {
  const data = object(value, "$");
  choice(data.format, "$.format", ["jank.js-comparison"]);
  if (data.version !== 1) {
    throw new RecordingError({
      code: "unsupported-version",
      path: "$.version",
      message: "Expected comparison version 1",
    });
  }
  const options = readOptions(data.options);
  const targetFps = number(data.targetFps, "$.targetFps", Number.MIN_VALUE);
  if (!Number.isFinite(1000 / targetFps)) {
    invalid("$.targetFps", "Frame budget must be finite");
  }
  const status = choice(data.status, "$.status", ["idle", "running", "complete", "cancelled"]);
  const trials = list(data.trials, "$.trials", options.pairs * 2, (value, path) =>
    readTrial(value, path, { targetFps, options }),
  );
  validateTrialOrder(trials);
  if (status === "complete" && trials.length !== options.pairs * 2) {
    invalid("$.trials", "A complete comparison needs every paired trial");
  }
  if (status === "idle" && trials.length !== 0) {
    invalid("$.trials", "An idle comparison cannot contain trials");
  }
  return {
    format: "jank.js-comparison",
    version: 1,
    options,
    targetFps,
    status,
    stage: choice(data.stage, "$.stage", ["ready", "warmup", "measure", "drain", "finalize"]),
    pair: integer(data.pair, "$.pair", 1, options.pairs),
    variant: choice(data.variant, "$.variant", ["A", "B"]),
    reason: text(data.reason, "$.reason", 4096),
    trials,
    summary: summarizeComparison(trials, options.pairs, status === "complete"),
  };
}
function readTrial(
  value: unknown,
  path: string,
  experiment: { targetFps: number; options: ComparisonOptions },
): ComparisonTrial {
  const data = object(value, path);
  const recording = nestedRecording(data.recording, `${path}.recording`);
  if (recording.targetFps !== experiment.targetFps) {
    invalid(`${path}.recording.targetFps`, "Trial budget differs from the comparison budget");
  }
  const first = recording.frames[0];
  const last = recording.frames.at(-1);
  if (first && last && last.endedAtMs > first.startedAtMs + experiment.options.measureMs) {
    invalid(`${path}.recording.frames`, "Trial extends beyond its measurement window");
  }
  return {
    pair: integer(data.pair, `${path}.pair`, 1, experiment.options.pairs),
    variant: choice(data.variant, `${path}.variant`, ["A", "B"]),
    context: readContext(data.context, `${path}.context`),
    recording,
    finalization: text(data.finalization, `${path}.finalization`, 4096),
    ...summarizeComparisonTrial(recording, experiment.options.measureMs),
  };
}
function validateTrialOrder(trials: readonly ComparisonTrial[]): void {
  trials.forEach((trial, index) => {
    const pair = Math.floor(index / 2) + 1;
    const variant = (index % 2 === 0) === (pair % 2 === 1) ? "A" : "B";
    if (trial.pair !== pair || trial.variant !== variant) {
      invalid(
        `$.trials[${index}]`,
        "Expected alternating AB / BA trial order without duplicates or gaps",
      );
    }
  });
}
export function parseComparison(json: string): ComparisonResult {
  const parsed = parseJsonData(json, readComparison);
  return parsed.ok ? { ok: true, comparison: parsed.value } : parsed;
}
