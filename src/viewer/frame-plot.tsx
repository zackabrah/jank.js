import type { frameChartGeometry } from "../frame-chart-geometry.ts";

/** Geometry is shared with LIVE; the viewer controls selection and range. */
export function FramePlot({
  chart,
  selected,
  multiples = false,
  bars,
}: {
  chart: ReturnType<typeof frameChartGeometry>;
  selected: number;
  multiples?: boolean;
  bars?: string;
}) {
  const spikeY = Math.max(0, chart.budgetY * 2 - chart.height);
  return (
    <svg viewBox="0 0 300 96" preserveAspectRatio="none" aria-hidden="true" class="block size-full">
      <rect
        data-budget-band=""
        y={spikeY}
        width="300"
        height={chart.budgetY - spikeY}
        class="fill-jank-over-band"
      />
      {multiples &&
        [2, 3, 4].map((multiple) => (
          <line
            key={multiple}
            x1="0"
            x2="300"
            y1={chart.height - (chart.height - chart.budgetY) * multiple}
            y2={chart.height - (chart.height - chart.budgetY) * multiple}
            class="stroke-jank-divider"
            vector-effect="non-scaling-stroke"
          />
        ))}
      {bars ? (
        <path d={bars} transform="scale(1 2.4)" class="fill-jank-bar" />
      ) : (
        <>
          <path d={chart.area} class="fill-jank-bar-area" />
          <path d={chart.line} fill="none" class="stroke-jank-bar" stroke-width="0.5" />
        </>
      )}
      <path d={chart.over} class="fill-jank-over-mark" />
      <line
        x1="0"
        x2="300"
        y1={chart.budgetY}
        y2={chart.budgetY}
        class="stroke-jank-budget-line"
        stroke-dasharray="3 3"
        vector-effect="non-scaling-stroke"
        stroke-width="0.5"
      />
      {!multiples && (
        <line
          x1={(selected + 0.5) * chart.pitch}
          x2={(selected + 0.5) * chart.pitch}
          y1="0"
          y2="96"
          class="stroke-jank-focus"
          stroke-width="0.75"
        />
      )}
    </svg>
  );
}
