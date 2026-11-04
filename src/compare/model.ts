// biome-ignore-all lint/complexity/useLiteralKeys: Unknown file fields require bracket access.
import { MAX_RECORDING_BYTES, parseRecording } from "../recording/format.ts";
import type { DiagnosticValues, PerformanceRecording } from "../recording/types.ts";

export type VariantKey = "A" | "B";
export interface ComparisonVariant {
  label: string;
  settings: DiagnosticValues;
}
export interface ComparisonPlan {
  warmupMs: number;
  measureMs: number;
  pairs: number;
}
interface ComparisonTrial {
  pair: number;
  variant: VariantKey;
  /** Recording clock, at sealed frame boundaries; warm-up is excluded. */
  measurementStartMs: number;
  measurementEndMs: number;
  recording: PerformanceRecording;
}
export interface ComparisonBundle {
  format: "jank.js-comparison";
  version: 1;
  status: "complete" | "stopped" | "interrupted" | "failed";
  reason: string;
  plan: ComparisonPlan;
  budgetMs: number;
  change: string;
  variants: Record<VariantKey, ComparisonVariant>;
  policy: { minSamples: number; minCoverage: number };
  trials: ComparisonTrial[];
}

export const MAX_REASON_LENGTH = 2000;
export const MAX_COMPARISON_MEASURE_MS = 30000;
export const defaultComparisonPlan: ComparisonPlan = { warmupMs: 500, measureMs: 1000, pairs: 2 };
export function validatePlan(plan: ComparisonPlan) {
  if (
    !Number.isFinite(plan.warmupMs) ||
    plan.warmupMs < 0 ||
    plan.warmupMs > 10000 ||
    !Number.isFinite(plan.measureMs) ||
    plan.measureMs < 100 ||
    plan.measureMs > MAX_COMPARISON_MEASURE_MS ||
    !Number.isSafeInteger(plan.pairs) ||
    plan.pairs < 1 ||
    plan.pairs > 5
  )
    throw new Error("Use 0–10\u00a0s warm-up, 0.1–30\u00a0s measurement and 1–5 pairs.");
  return { warmupMs: plan.warmupMs, measureMs: plan.measureMs, pairs: plan.pairs };
}
export function comparisonSchedule(pairs: number) {
  return Array.from({ length: pairs * 2 }, (_, index) => ({
    pair: Math.floor(index / 2) + 1,
    variant: (["A", "B", "B", "A"] as const)[index % 4] ?? "A",
  }));
}
export function settingDifferences(
  variants: Record<VariantKey, ComparisonVariant>,
  change: string,
) {
  return [
    ...new Set([...Object.keys(variants.A.settings), ...Object.keys(variants.B.settings)]),
  ].filter((key) => key !== change && variants.A.settings[key] !== variants.B.settings[key]);
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a comparison object.");
  return value as Record<string, unknown>;
};
const number = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid comparison number.");
  return value;
};
const text = (value: unknown, max = 240) => {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid comparison text.");
  return value;
};
function readVariants(value: unknown): Record<VariantKey, ComparisonVariant> {
  const variants = object(value);
  const read = (key: VariantKey): ComparisonVariant => {
    const variant = object(variants[key]);
    const label = text(variant["label"]);
    if (!label.trim()) throw new Error("Variant labels cannot be empty.");
    const entries = Object.entries(object(variant["settings"]));
    if (entries.length > 64) throw new Error("Too many variant settings.");
    return {
      label,
      settings: Object.fromEntries(
        entries.map(([name, value]) => {
          if (
            !name.trim() ||
            name.length > 240 ||
            !(
              value === null ||
              typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value)) ||
              (typeof value === "string" && value.length <= 240)
            )
          )
            throw new Error("Invalid variant setting.");
          return [name, value];
        }),
      ),
    };
  };
  return { A: read("A"), B: read("B") };
}

/** Validates the whole run before replacing anything already open. */
export function parseComparison(json: string): ComparisonBundle {
  if (
    json.length > MAX_RECORDING_BYTES ||
    new TextEncoder().encode(json).length > MAX_RECORDING_BYTES
  )
    throw new Error("Comparison exceeds 32 MiB.");
  const root = object(JSON.parse(json));
  if (root["format"] !== "jank.js-comparison" || root["version"] !== 1)
    throw new Error("Unsupported comparison format.");
  const status = root["status"];
  if (
    status !== "complete" &&
    status !== "stopped" &&
    status !== "interrupted" &&
    status !== "failed"
  )
    throw new Error("Invalid comparison status.");
  const rawPlan = object(root["plan"]);
  const plan = validatePlan({
    warmupMs: number(rawPlan["warmupMs"]),
    measureMs: number(rawPlan["measureMs"]),
    pairs: number(rawPlan["pairs"]),
  });
  const budgetMs = number(root["budgetMs"]);
  if (budgetMs < 1 || budgetMs > 1000) throw new Error("Invalid comparison budget.");
  const variants = readVariants(root["variants"]);
  const change = text(root["change"]);
  if (
    !change.trim() ||
    !Object.hasOwn(variants.A.settings, change) ||
    !Object.hasOwn(variants.B.settings, change)
  )
    throw new Error("Name the reported setting under test.");
  const rawPolicy = object(root["policy"]);
  const policy = {
    minSamples: number(rawPolicy["minSamples"]),
    minCoverage: number(rawPolicy["minCoverage"]),
  };
  if (
    !Number.isSafeInteger(policy.minSamples) ||
    policy.minSamples < 1 ||
    policy.minSamples > 6000 ||
    policy.minCoverage <= 0 ||
    policy.minCoverage > 1
  )
    throw new Error("Invalid comparison coverage policy.");
  const schedule = comparisonSchedule(plan.pairs);
  const rawTrials = root["trials"];
  if (
    !Array.isArray(rawTrials) ||
    rawTrials.length > schedule.length ||
    (status === "complete" && rawTrials.length !== schedule.length)
  )
    throw new Error("Invalid completed trial count.");
  const trials = rawTrials.map((value, index): ComparisonTrial => {
    const trial = object(value);
    const expected = schedule[index];
    if (!expected || trial["pair"] !== expected.pair || trial["variant"] !== expected.variant)
      throw new Error("Trials must follow the planned ABBA order.");
    const measurementStartMs = number(trial["measurementStartMs"]);
    const measurementEndMs = number(trial["measurementEndMs"]);
    const recording = parseRecording(JSON.stringify(trial["recording"]));
    const first = recording.frames[0];
    const last = recording.frames.at(-1);
    if (
      !first ||
      !last ||
      measurementEndMs - measurementStartMs < plan.measureMs ||
      first.at - first.interval < measurementStartMs - 0.000001 ||
      last.at !== measurementEndMs ||
      recording.budget.frameMs !== budgetMs ||
      recording.capture.mode !== "manual" ||
      recording.capture.state !== "idle"
    )
      throw new Error("Invalid trial measurement window or budget.");
    return { ...expected, measurementStartMs, measurementEndMs, recording };
  });
  return {
    format: "jank.js-comparison",
    version: 1,
    status,
    reason: text(root["reason"], MAX_REASON_LENGTH),
    plan,
    budgetMs,
    change,
    variants,
    policy,
    trials,
  };
}
export function serializeComparison(bundle: ComparisonBundle) {
  const json = JSON.stringify(bundle);
  parseComparison(json);
  return json;
}
