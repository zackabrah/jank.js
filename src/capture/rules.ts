import { withUnit } from "../format.ts";
import { maxAfterFrames, maxBeforeFrames } from "../recording/format.ts";
import type { CaptureRule, RuleSettings } from "../recording/types.ts";

export interface RuleLimits {
  capacity: number;
  beforeFrames: number;
  afterFrames: number;
  episodes: boolean;
}

export function ruleLimits(capacity: number, episodes: boolean): RuleLimits {
  return {
    capacity,
    beforeFrames: Math.min(maxBeforeFrames, capacity - 1),
    afterFrames: Math.min(maxAfterFrames, capacity - 1),
    episodes,
  };
}

export function compileRule(
  settings: RuleSettings,
  budget: number,
  limits: RuleLimits,
): CaptureRule {
  if (!Number.isFinite(budget) || budget < 1 || budget > 1000)
    throw new Error("The host must supply a valid frame budget.");
  if (
    !["spike", "sustained", "episode"].includes(settings.mode) ||
    !["fixed", "episode"].includes(settings.keep)
  )
    throw new Error("Choose a valid trigger and capture window.");
  if (!limits.episodes && (settings.mode !== "spike" || settings.keep !== "fixed"))
    throw new Error(
      "This host supports fixed spike windows only. Connect the rule capture adapter for sustained and episode capture.",
    );
  for (const [label, value, min, max] of [
    ["Threshold", settings.thresholdMs, 0.001, 60000],
    ["Sustained duration", settings.sustainedMs, 1, 60000],
    ["Quiet recovery", settings.quietMs, 1, 60000],
    ["Episode limit", settings.limitMs, 1, 3600000],
    ["Before trigger", settings.beforeSeconds, 0, 6000],
    ["After trigger", settings.afterSeconds, 0, 6000],
    ["Cooldown", settings.cooldownMs, 0, 3600000],
  ] as const) {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(
        `${label} must be between ${min} and ${max}${label.endsWith("trigger") ? " seconds" : " ms"}.`,
      );
  }
  if (settings.keep === "episode" && settings.limitMs < settings.quietMs)
    throw new Error("Episode limit must be at least the quiet recovery duration.");
  if (
    settings.keep === "episode" &&
    settings.mode !== "spike" &&
    settings.limitMs < settings.sustainedMs
  )
    throw new Error("Episode limit must be at least the sustained duration.");
  const beforeFrames = Math.max(0, Math.ceil((settings.beforeSeconds * 1000) / budget - 1e-9));
  const afterFrames = Math.max(0, Math.ceil((settings.afterSeconds * 1000) / budget - 1e-9));
  if (beforeFrames > limits.beforeFrames)
    throw new Error(
      `Before trigger exceeds the host limit of ${limits.beforeFrames} frames at this budget.`,
    );
  if (afterFrames > limits.afterFrames)
    throw new Error(
      `After trigger exceeds the host limit of ${limits.afterFrames} frames at this budget.`,
    );
  if (beforeFrames + afterFrames + 1 > limits.capacity)
    throw new Error(`Before + trigger + after must fit within ${limits.capacity} frames.`);
  return { ...settings, beforeFrames, afterFrames, budgetMs: budget };
}

export function describeRule(rule: CaptureRule) {
  const trigger =
    rule.mode === "spike"
      ? `1 frame exceeds ${withUnit(Number(rule.thresholdMs.toFixed(3)), "ms")}`
      : `frames stay over ${withUnit(Number(rule.budgetMs.toFixed(3)), "ms")} for ${withUnit(rule.sustainedMs, "ms")}`;
  const keep =
    rule.keep === "episode"
      ? `the episode until ${withUnit(rule.quietMs / 1000, "s")} quiet, then ${rule.afterFrames} frames after`
      : `${rule.afterFrames} frames after`;
  return `When ${trigger}, keep ${rule.beforeFrames} frames before and ${keep}; cooldown ${withUnit(rule.cooldownMs / 1000, "s")}.`;
}
