import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { withUnit } from "../format.ts";
import type { ComparisonRange } from "./comparison-range.ts";

export function ComparisonTrack({
  range,
  at,
  onSelect,
  onHover,
  label,
  readout,
  className,
  children,
}: {
  range: ComparisonRange;
  at: number;
  onSelect: (at: number) => void;
  /** A mouse preview that ends when the pointer leaves, so the selected time survives the trip. */
  onHover: (at: number | null) => void;
  label: string;
  readout: string;
  className: string;
  children: ComponentChildren;
}) {
  const pointer = useRef<number | null>(null);
  const duration = range.end - range.start;
  const position = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    return (
      range.start +
      Math.max(0, Math.min(1, (x - bounds.left) / Math.max(1, bounds.width))) * duration
    );
  };
  return (
    <div
      role="slider"
      data-comparison-track=""
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={range.start}
      aria-valuemax={range.end}
      aria-valuenow={at}
      aria-valuetext={`${withUnit((at / 1000).toFixed(3), "s")} since measurement start. ${readout}`}
      class={`focus-ring relative cursor-crosshair touch-none select-none ${className}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        onHover(null);
        onSelect(position(event.currentTarget, event.clientX));
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId)
          onSelect(position(event.currentTarget, event.clientX));
        else if (event.pointerType === "mouse" && !event.buttons)
          onHover(position(event.currentTarget, event.clientX));
      }}
      onPointerLeave={() => onHover(null)}
      onPointerUp={(event) => {
        if (pointer.current !== event.pointerId) return;
        onSelect(position(event.currentTarget, event.clientX));
        pointer.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
      onPointerCancel={() => {
        pointer.current = null;
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        const step = Math.max(1, duration / 1000);
        const next =
          event.key === "Home"
            ? range.start
            : event.key === "End"
              ? range.end
              : event.key === "ArrowRight" || event.key === "ArrowUp"
                ? at + step
                : event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? at - step
                  : event.key === "PageUp"
                    ? at + duration / 10
                    : event.key === "PageDown"
                      ? at - duration / 10
                      : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        onHover(null);
        onSelect(Math.max(range.start, Math.min(range.end, next)));
      }}
    >
      {children}
      <span
        data-comparison-cursor=""
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 border-l border-jank-focus"
        style={{ left: `${((at - range.start) / duration) * 100}%` }}
      />
    </div>
  );
}
