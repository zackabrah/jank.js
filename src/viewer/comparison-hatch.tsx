import { useId } from "preact/hooks";
import { type ComparisonRange, comparisonWindow } from "./comparison-range.ts";

export function ComparisonHatch({
  path,
  series,
  range,
  duration,
}: {
  path: string;
  series: "A" | "B" | "difference";
  range: ComparisonRange;
  duration: number;
}) {
  const id = useId();
  const window = comparisonWindow(range, duration);
  return (
    // Keep the pattern in screen pixels; only the missing-interval clip scales with the track.
    <svg
      aria-hidden="true"
      data-comparison-hatch={series}
      class={`pointer-events-none absolute inset-0 size-full ${series === "A" ? "text-jank-series-a" : series === "B" ? "text-jank-series-b" : "text-jank-text-secondary"}`}
    >
      <defs>
        <pattern id={`${id}-pattern`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 8L8 0" fill="none" stroke="currentColor" stroke-width="1" />
        </pattern>
        <clipPath id={`${id}-clip`} clipPathUnits="objectBoundingBox">
          <path
            data-comparison-lane-missing={series === "difference" ? undefined : series}
            data-comparison-difference-missing={series === "difference" ? "" : undefined}
            d={path}
            transform={`scale(${1 / window.width} 0.01) translate(${-window.left} ${series === "B" ? -12 : 0})`}
          />
        </clipPath>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${id}-pattern)`}
        clip-path={`url(#${id}-clip)`}
      />
    </svg>
  );
}
