import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { AutomaticCapture } from "../capture/controller.ts";
import { formatMs, formatSeconds, NBSP, withUnit } from "../format.ts";
import { frameChartGeometry } from "../frame-chart-geometry.ts";
import { useChartScale } from "./chart-scale.ts";
import { EventRail } from "./event-rail.tsx";
import type { LiveView } from "./model.ts";

export function FrameChart({
  view,
  compact = false,
  frozen = false,
  recordingAfterFrame,
  automatic,
}: {
  view: LiveView;
  compact?: boolean;
  frozen?: boolean;
  recordingAfterFrame?: number | null | undefined;
  automatic?: AutomaticCapture | null | undefined;
}) {
  const clipId = useId();
  const hintId = useId();
  const [inspectedId, setInspectedId] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const scale = useChartScale(view);
  const { width, height, ceiling, budgetY, line, area, over, pitch, left } = useMemo(
    () => frameChartGeometry(view.frames, view.budget, view.overLimit, 180, scale),
    [view.frames, view.budget, view.overLimit, scale],
  );
  const inspectedIndex = view.frames.findIndex((frame) => frame.id === inspectedId);
  useEffect(() => {
    if (inspectedIndex < 0) setInspectedId(null);
  }, [inspectedIndex]);
  const activeIndex = inspectedIndex >= 0 ? inspectedIndex : focused ? view.frames.length - 1 : -1;
  const active = view.frames[activeIndex];
  const worstIndex = view.frames.findIndex((frame) => frame.id === view.worstFrame);
  const worst = view.frames[worstIndex];
  const readout = active ?? worst;
  const difference = readout ? readout.interval - view.budget : 0;
  const frameDescription = (frame: NonNullable<typeof readout>) =>
    `Frame ${frame.id}, ${frame.interval.toFixed(1)} milliseconds, ${Math.abs(frame.interval - view.budget).toFixed(1)} milliseconds ${frame.interval >= view.budget ? "above" : "below"} budget`;
  const firstRecorded =
    recordingAfterFrame === undefined
      ? -1
      : view.frames.findIndex((frame) => frame.id > (recordingAfterFrame ?? -1));
  const recordedCount = firstRecorded < 0 ? 0 : view.frames.length - firstRecorded;
  const autoWindow = automatic?.window;
  const autoFrames = autoWindow
    ? view.frames.filter((frame) => frame.id >= autoWindow.first && frame.id <= autoWindow.last)
    : [];
  const firstAuto = view.frames.findIndex((frame) => frame.id === autoFrames[0]?.id);
  const triggerIndex = view.frames.findIndex((frame) => frame.id === autoWindow?.trigger);
  const frameX = (index: number) => (width * (180 - view.frames.length + index)) / 180;
  return (
    <div class="px-3 py-2" data-chart-ceiling={ceiling}>
      {!compact && (
        <div class="mb-1 flex justify-between gap-2 font-mono text-label-12 text-jank-text-secondary">
          <span>
            {view.frames.length
              ? `last ${view.frames.length} frames · ${view.windowSeconds?.toFixed(1)}${NBSP}s`
              : "Waiting for frames"}
          </span>
          <span>
            {view.frames.at(-1) ? `${frozen ? "held " : ""}f${view.frames.at(-1)?.id} →` : ""}
          </span>
        </div>
      )}
      <div class="relative">
        <svg
          class={`block w-full ${compact ? "h-10" : "focus-ring h-24 cursor-crosshair"}`}
          viewBox="0 0 300 96"
          preserveAspectRatio="none"
          {...(!compact && readout
            ? {
                role: "slider",
                tabindex: 0,
                "aria-label": "Inspect frame intervals",
                "aria-valuemin": 0,
                "aria-valuemax": view.frames.length - 1,
                "aria-valuenow": activeIndex >= 0 ? activeIndex : worstIndex,
                "aria-valuetext": frameDescription(readout),
              }
            : {
                role: "img",
                "aria-label": `${view.frames.length} frame intervals; ${view.overCount} over budget. Budget ${view.budget.toFixed(1)} milliseconds.`,
              })}
          aria-describedby={!compact ? hintId : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setInspectedId(null);
          }}
          onPointerMove={(event) => {
            if (compact) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * width;
            const index = Math.min(view.frames.length - 1, Math.floor((x - left) / pitch));
            setInspectedId(view.frames[index]?.id ?? null);
          }}
          onPointerLeave={() => {
            if (!focused) setInspectedId(null);
          }}
          onKeyDown={(event) => {
            if (compact || !view.frames.length || event.altKey || event.ctrlKey || event.metaKey)
              return;
            const current = activeIndex < 0 ? view.frames.length - 1 : activeIndex;
            const next =
              event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? current - 1
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? current + 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? view.frames.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            setInspectedId(
              view.frames[Math.max(0, Math.min(view.frames.length - 1, next))]?.id ?? null,
            );
          }}
        >
          <title>Live frame intervals</title>
          <defs>
            <clipPath id={clipId}>
              <rect width={width} height={height} />
            </clipPath>
          </defs>
          <g clip-path={`url(#${clipId})`}>
            <rect width={width} height={budgetY} class="fill-jank-over-band" />
            <path d={area} class="fill-jank-bar-area" />
            <path data-chart="line" d={line} fill="none" class="stroke-jank-bar" stroke-width="1" />
            <path
              data-chart="over"
              d={over}
              class="fill-jank-over-mark stroke-jank-over-mark"
              stroke-width="0.5"
            />
            <line
              x1="0"
              x2={width}
              y1={budgetY}
              y2={budgetY}
              class="stroke-jank-budget-line"
              stroke-dasharray="3 3"
            />
            {frozen && <line x1="299" x2="299" y1="0" y2={height} class="stroke-jank-frozen" />}
          </g>
          {!compact && worst && (
            <circle
              data-chart="worst"
              cx={left + (worstIndex + 0.5) * pitch}
              cy={height * (1 - worst.interval / ceiling)}
              r="3"
              class="fill-jank-surface stroke-jank-text"
            />
          )}
          {!compact && active && (
            <line
              data-chart="inspection"
              x1={left + (activeIndex + 0.5) * pitch}
              x2={left + (activeIndex + 0.5) * pitch}
              y1="0"
              y2={height}
              class="stroke-jank-focus"
              stroke-dasharray="2 2"
            />
          )}
        </svg>
        {!compact && (
          <div
            class="pointer-events-none absolute inset-0 text-right font-mono text-label-12 text-jank-text-secondary"
            aria-hidden="true"
          >
            <span class="absolute top-0 right-1 bg-jank-surface/90 px-1">
              {withUnit(ceiling, "ms")}
            </span>
            <span
              class="absolute right-1 bg-jank-surface/90 px-1"
              style={{ top: `${Math.max(16, budgetY - 8)}px` }}
            >
              {view.budget.toFixed(1)}
            </span>
          </div>
        )}
      </div>
      <EventRail view={view} compact={compact} />
      {!compact && (
        <>
          <p
            data-chart="readout"
            data-over-budget={readout && readout.interval > view.overLimit ? "" : undefined}
            class="min-h-4 pt-1 font-mono text-label-12 text-jank-text-secondary tabular-nums peer-data-reading/rail:hidden data-over-budget:text-jank-over"
          >
            {readout
              ? `${active ? "" : "Worst "}f${readout.id} · ${formatMs(readout.interval)} · ${difference > 0 ? "+" : ""}${formatMs(difference)} vs budget`
              : "No frame samples"}
          </p>
          <p id={hintId} class="sr-only">
            Arrow keys inspect frames. Home and End select the first and last frame. F toggles
            Freeze.
          </p>
        </>
      )}
      {recordingAfterFrame !== undefined && (
        <svg
          viewBox="0 0 300 4"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Manual recording: ${recordedCount} frames in the displayed window`}
          class="mt-1 block h-1 w-full"
        >
          <title>Manual recording window</title>
          {recordedCount > 0 && (
            <rect
              x={(width * (180 - recordedCount)) / 180}
              y="0"
              width={(width * recordedCount) / 180}
              height="4"
              class="fill-jank-rec-text"
            />
          )}
        </svg>
      )}
      {automatic && automatic.state !== "off" && (
        <svg
          viewBox="0 0 300 4"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Automatic capture: ${autoFrames.length} frames in the displayed window`}
          class="mt-1 block h-1 w-full"
        >
          <title>Automatic capture window</title>
          {!autoWindow && (
            <line
              x1="0"
              x2={width}
              y1="2"
              y2="2"
              stroke-dasharray="3 3"
              class="stroke-jank-capture"
            />
          )}
          {autoFrames.length > 0 && (
            <rect
              x={frameX(firstAuto)}
              width={(width * autoFrames.length) / 180}
              height="4"
              class="fill-jank-capture"
            />
          )}
          {triggerIndex >= 0 && (
            <line
              data-trigger-frame={autoWindow?.trigger}
              x1={frameX(triggerIndex) + width / 360}
              x2={frameX(triggerIndex) + width / 360}
              y1="0"
              y2="4"
              class="stroke-jank-text"
            />
          )}
        </svg>
      )}
      {!compact && recordingAfterFrame !== undefined && (
        <p class="mt-1 font-mono text-label-12 text-jank-rec-text">
          ● Recording ·{" "}
          {recordedCount
            ? `${recordedCount} frames in view`
            : frozen
              ? "outside this held window"
              : "waiting for frames"}
        </p>
      )}
      {!compact && automatic && automatic.state !== "off" && (
        <p class="mt-1 font-mono text-label-12 text-jank-capture">
          {automatic.state === "armed"
            ? automatic.rule.mode === "spike"
              ? `Armed · 1 frame > ${formatMs(automatic.rule.thresholdMs)}`
              : `Armed · over budget for ${withUnit(automatic.rule.sustainedMs, "ms")}`
            : automatic.state === "capturing"
              ? automatic.stage === "episode"
                ? `Episode · ${formatSeconds(automatic.episodeMs / 1000, 2)}`
                : `Capturing · ${automatic.remainingFrames} after-frames left`
              : `Cooldown · ${formatSeconds(automatic.cooldownRemainingMs / 1000)}`}
          {autoWindow && !autoFrames.length && frozen ? " · outside this held window" : ""}
        </p>
      )}
    </div>
  );
}
