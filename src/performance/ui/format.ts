import type { RecordingEnvironment } from "../../core/recording-types.ts";

/** Shared readout formatting for the panel and the viewer. Values are never smoothed. */
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const million = 1e6;

const nsPerMs = 1e6;

const usPerMs = 1000;

/** One microsecond, in milliseconds. */
const microsecondMs = 0.001;

const decade = 10;

const halfDecade = decade / 2;

const quarterDecade = halfDecade / 2;

/** Axis steps are 1, 2, 2.5 or 5 times a power of ten. */
const axisFactors = [1, 2, quarterDecade, halfDecade, decade];

const maxAxisDivisions = 3;

/** Keeps log10 finite for an empty axis. */
const minAxisSpan = 1e-9;

/** Rounds to a whole number with thousands separators, e.g. 12,345. */
export const count = (value: number) => grouped.format(value);

/** A number to `digits` decimal places, one by default. */
export const fixed = (value: number, digits = 1) => value.toFixed(digits);

/** Counter readouts: integers grouped, millions to three figures, fractions to two places. */
export function counter(value: number | string | boolean | null): string {
  if (value === null) return "unknown";

  if (typeof value === "boolean") return value ? "on" : "off";

  if (typeof value === "string") return value;

  if (Math.abs(value) >= million) return `${(value / million).toFixed(2)}M`;

  return Number.isInteger(value) ? count(value) : value.toFixed(2);
}

/** `drawCalls` and `draw_calls` both read as `draw calls`. */
export const words = (key: string) =>
  key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .toLowerCase();

/** A time in ns, µs or ms, whichever keeps it readable. */
export function duration(milliseconds: number): string {
  if (milliseconds < microsecondMs)
    return `${Math.round(milliseconds * nsPerMs)} ns`;

  if (milliseconds < 1) return `${Math.round(milliseconds * usPerMs)} µs`;

  return `${milliseconds.toFixed(1)} ms`;
}

/** The recording's own statement of what it could and could not measure. */
export function timerHonesty(environment: RecordingEnvironment) {
  let isolation = "isolation unknown";

  if (environment.crossOriginIsolated !== null)
    isolation = environment.crossOriginIsolated ? "isolated" : "not isolated";

  const cpu = environment.cpuTimer.estimatedResolutionMs;

  const gpu = environment.gpuTimer.estimatedResolutionMs;

  return {
    cpu: `${isolation} · cpu timer ${cpu === null ? "unknown" : `~${duration(cpu)} est.`}`,
    gpu: `gpu timer ${gpu === null ? "unknown" : `~${duration(gpu)} est.`}`,
  };
}

/**
 * The budget line plus what the clock cannot resolve. Both ends of an interval are timer
 * readings, so an interval within two ticks of the budget cannot be told apart from it.
 */
export const budgetLimit = (budgetMs: number, timerMs: number | null) =>
  budgetMs + 2 * (timerMs ?? 0);

/**
 * The timer tick seen in the intervals themselves, for when the core has no estimate:
 * the smallest step between distinct sorted values (float noise under 1 µs is not a
 * step), never more than 1 ms, the coarsest precision a browser ships by default.
 */
export function observedTick(sorted: ArrayLike<number>): number | null {
  let tick = Infinity;

  for (let i = 1; i < sorted.length; i++) {
    const step = sorted[i]! - sorted[i - 1]!;

    if (step >= microsecondMs && step < tick) tick = step;
  }

  return Number.isFinite(tick) ? Math.min(1, tick) : null;
}

/** A readable axis step: 1, 2, 2.5 or 5 times a power of ten, at most three divisions. */
export function axisStep(longest: number) {
  const magnitude =
    decade **
    Math.floor(Math.log10(Math.max(longest, minAxisSpan) / maxAxisDivisions));

  for (const factor of axisFactors)
    if (longest / (factor * magnitude) <= maxAxisDivisions)
      return factor * magnitude;

  return decade * magnitude;
}

/** Shorten by rule, never mid-word: drop trailing words until the text fits. */
export function shorten(text: string, characters: number): string {
  if (text.length <= characters) return text;

  const parts = text.split(" ");

  while (parts.length > 1 && parts.join(" ").length > characters) parts.pop();

  return parts.join(" ").length <= characters ? parts.join(" ") : "";
}

/** The distinct sources of systems that report counters: each label's first word, lowercased. */
export const counterSources = (
  systems: readonly { label: string; values: object }[],
) => [
  ...new Set(
    systems
      .filter((system) => Object.keys(system.values).length)
      .map((system) => system.label.split(" ")[0]!.toLowerCase()),
  ),
];
