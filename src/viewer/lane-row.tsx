import type { ComponentChildren } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { frameOverLimit } from "../recording/summary.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { laneGeometry, laneValue, type recordingLanes, type TimingLane } from "./lanes.ts";
import type { ViewerSelection } from "./selection.ts";

export function FrameTrack({
  recording,
  selection,
  onSelect,
  label,
  valueText,
  children,
  className,
}: {
  recording: PerformanceRecording;
  selection: ViewerSelection;
  onSelect: (index: number) => void;
  label: string;
  valueText: string;
  children: ComponentChildren;
  className: string;
}) {
  const pointer = useRef<number | null>(null);
  const select = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    const count = selection.end - selection.start + 1;
    onSelect(
      selection.start +
        Math.max(
          0,
          Math.min(count - 1, Math.floor(((x - bounds.left) / Math.max(1, bounds.width)) * count)),
        ),
    );
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={recording.frames.length - 1}
      aria-valuenow={selection.selected}
      aria-valuetext={valueText}
      class={`focus-ring relative touch-none select-none ${className}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        select(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId) select(event.currentTarget, event.clientX);
      }}
      onPointerUp={(event) => {
        if (pointer.current !== event.pointerId) return;
        select(event.currentTarget, event.clientX);
        pointer.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
    >
      {children}
      <FrameCursor selection={selection} />
    </div>
  );
}

export function FrameCursor({ selection }: { selection: ViewerSelection }) {
  return (
    <span
      aria-hidden="true"
      data-lane-cursor=""
      class="pointer-events-none absolute inset-y-0 border-l border-jank-focus"
      style={{
        left: `${((selection.selected - selection.start + 0.5) / (selection.end - selection.start + 1)) * 100}%`,
      }}
    />
  );
}

export function LaneRow({
  lane,
  model,
  recording,
  selection,
  onSelect,
  expand,
}: {
  lane: TimingLane;
  model: ReturnType<typeof recordingLanes>;
  recording: PerformanceRecording;
  selection: ViewerSelection;
  onSelect: (index: number) => void;
  expand: boolean;
}) {
  const { start, end, selected } = selection;
  const ceiling = lane.group === "gpu" ? model.gpuCeiling : model.cpuCeiling;
  const geometry = useMemo(
    () =>
      laneGeometry(
        recording.frames
          .slice(start, end + 1)
          .map((_, offset) => laneValue(lane, start + offset, recording, model.gpuFrames)),
        ceiling,
      ),
    [recording, lane, model, start, end, ceiling],
  );
  const overLimit = useMemo(() => frameOverLimit(recording), [recording]);
  const cell = laneValue(lane, selected, recording, model.gpuFrames);
  const quiet = lane.group !== "gpu" && geometry.quiet && !expand;
  const value =
    cell.value === null
      ? cell.status === "missing"
        ? "no record"
        : cell.status === "absent"
          ? "absent"
          : cell.status
      : `${cell.value.toFixed(2)}${cell.status === "partial" ? "*" : ""}`;
  return (
    <div
      class="grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 border-b border-jank-divider"
      data-timing-lane={lane.id}
      data-lane-group={lane.group}
      data-quiet={quiet || undefined}
    >
      <span
        class="truncate text-right text-label-12 text-jank-text-secondary"
        title={lane.description}
      >
        {lane.label}
      </span>
      <FrameTrack
        recording={recording}
        selection={selection}
        onSelect={onSelect}
        label={`${lane.label} ${lane.group} lane`}
        valueText={`Frame ${recording.frames[selected]?.id}: ${value}${cell.value !== null ? " milliseconds" : ""}. ${cell.reason}. ${lane.description}`}
        className={quiet ? "h-5" : "h-8"}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 300 40"
          preserveAspectRatio="none"
          class="block size-full"
        >
          <path d="M0,40H300" class="stroke-jank-divider" />
          <path d={geometry.bars} class="fill-jank-bar" />
          <path d={geometry.zero} class="stroke-jank-bar" />
          <path d={geometry.missing} data-lane-missing="" class="stroke-jank-text-secondary" />
          <path d={geometry.rejected} data-lane-rejected="" class="stroke-jank-error" />
          <path d={geometry.pending} class="stroke-jank-over" />
          <path d={geometry.unknown} class="stroke-jank-text-secondary" stroke-dasharray="1 2" />
        </svg>
      </FrameTrack>
      <span
        class="truncate text-right font-mono text-label-12 data-over:text-jank-over data-rejected:text-jank-error"
        data-over={(cell.value !== null && cell.value > overLimit) || undefined}
        data-rejected={cell.status === "rejected" || undefined}
        title={`${value} · ${cell.reason}`}
        data-lane-value={cell.status}
      >
        {value}
      </span>
    </div>
  );
}
