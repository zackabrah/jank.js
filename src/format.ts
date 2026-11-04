/** U+00A0. Keeps a number and its unit on one line: "16.7 ms" never breaks into "16.7" and "ms". */
export const NBSP = " ";

/**
 * Fixed decimals below 100 and whole numbers from 100, so a value never outgrows its cell at
 * slow frame rates (7214 ms, not 7214.0 ms).
 */
export function formatNumber(value: number, digits = 1) {
  return Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(digits);
}

/** Joins a value and its unit with a non-breaking space. */
export function withUnit(value: string | number, unit: string) {
  return `${value}${NBSP}${unit}`;
}

/** A duration in milliseconds: "16.7 ms", "2.45 ms" with digits 2, "7214 ms". */
export function formatMs(value: number, digits = 1) {
  return withUnit(formatNumber(value, digits), "ms");
}

/** A duration in seconds: "0.7 s", "6.08 s" with digits 2. */
export function formatSeconds(value: number, digits = 1) {
  return withUnit(formatNumber(value, digits), "s");
}

/** Singular or plural noun for a count: plural(1, "trial") is "trial", plural(2, "trial") "trials". */
export function plural(count: number, one: string, many = `${one}s`) {
  return count === 1 ? one : many;
}
