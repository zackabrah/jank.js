export function unionDuration(intervals: { start: number; end: number }[]) {
  let end = -Infinity;
  let duration = 0;
  for (const span of intervals.toSorted((a, b) => a.start - b.start)) {
    duration += Math.max(0, span.end - Math.max(end, span.start));
    end = Math.max(end, span.end);
  }
  return duration;
}
