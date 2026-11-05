export interface ComparisonRange {
  start: number;
  end: number;
}

export interface ComparisonSelection extends ComparisonRange {
  at: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// Keep a nonzero window even for recordings near the floating-point limit.
export const minimumComparisonRange = (duration: number) =>
  Math.min(duration, Math.max(1, duration * 1e-9));

export function fitComparisonRange(duration: number, at = 0): ComparisonSelection {
  return { start: 0, end: duration, at: clamp(at, 0, duration) };
}

export function selectComparisonRange(
  state: ComparisonSelection,
  first: number,
  last: number,
  duration: number,
): ComparisonSelection {
  const minimum = minimumComparisonRange(duration);
  const start = clamp(Math.min(first, last), 0, duration - minimum);
  const end = clamp(Math.max(first, last), start + minimum, duration);
  return { start, end, at: clamp(state.at, start, end) };
}

export function panComparisonRange(
  state: ComparisonSelection,
  delta: number,
  duration: number,
): ComparisonSelection {
  const width = state.end - state.start;
  const start = clamp(state.start + delta, 0, duration - width);
  return { start, end: start + width, at: clamp(state.at, start, start + width) };
}

export function zoomComparisonRange(
  state: ComparisonSelection,
  factor: number,
  duration: number,
): ComparisonSelection {
  const width = clamp(
    (state.end - state.start) * factor,
    minimumComparisonRange(duration),
    duration,
  );
  const start = clamp(state.at - width / 2, 0, duration - width);
  return { start, end: start + width, at: state.at };
}

export function comparisonWindow(range: ComparisonRange, duration: number) {
  const left = (range.start / duration) * 100;
  const width = ((range.end - range.start) / duration) * 100;
  return {
    left,
    width,
    viewBox: `${left} 0 ${width} 100`,
    position: (at: number) => ((at - range.start) / (range.end - range.start)) * 100,
  };
}
