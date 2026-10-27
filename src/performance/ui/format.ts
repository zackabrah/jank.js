import type { RecordingEnvironment } from "../../core/recording-types.ts";

/** Shared readout formatting for the panel and the viewer. Values are never smoothed. */
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const count = (value: number) => grouped.format(value);

export const fixed = (value: number, digits = 1) => value.toFixed(digits);

/** Counter readouts: integers grouped, millions to three figures, fractions to two places. */
export function counter(value: number | string | boolean | null): string {
  if (value === null) return "unknown";

  if (typeof value === "boolean") return value ? "on" : "off";

  if (typeof value === "string") return value;

  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;

  return Number.isInteger(value) ? count(value) : value.toFixed(2);
}

/** `drawCalls` and `draw_calls` both read as `draw calls`. */
export const words = (key: string) =>
  key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .toLowerCase();

export function duration(milliseconds: number): string {
  if (milliseconds < 0.001) return `${Math.round(milliseconds * 1e6)} ns`;

  if (milliseconds < 1) return `${Math.round(milliseconds * 1000)} µs`;

  return `${milliseconds.toFixed(1)} ms`;
}

/** The recording's own statement of what it could and could not measure. */
export function timerHonesty(environment: RecordingEnvironment) {
  const isolation =
    environment.crossOriginIsolated === null
      ? "isolation unknown"
      : environment.crossOriginIsolated
        ? "isolated"
        : "not isolated";

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

    if (step >= 0.001 && step < tick) tick = step;
  }

  return Number.isFinite(tick) ? Math.min(1, tick) : null;
}

/** A readable axis step: 1, 2, 2.5 or 5 times a power of ten, at most three divisions. */
export function axisStep(longest: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(longest, 1e-9) / 3));

  for (const factor of [1, 2, 2.5, 5, 10])
    if (longest / (factor * magnitude) <= 3) return factor * magnitude;

  return 10 * magnitude;
}

/** Shorten by rule, never mid-word: drop trailing words until the text fits. */
export function shorten(text: string, characters: number): string {
  if (text.length <= characters) return text;

  const parts = text.split(" ");

  while (parts.length > 1 && parts.join(" ").length > characters) parts.pop();

  return parts.join(" ").length <= characters ? parts.join(" ") : "";
}
