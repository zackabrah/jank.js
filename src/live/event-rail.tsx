import { useEffect, useId, useState } from "preact/hooks";
import { eventPosition } from "./events.ts";
import type { LiveView } from "./model.ts";

export function EventRail({ view, compact }: { view: LiveView; compact: boolean }) {
  const hintId = useId();
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const events = view.events?.filter((event) => event.frameId !== null) ?? [];
  const selected = events.findIndex((event) => event.id === inspectedId);
  useEffect(() => {
    if (selected < 0) setInspectedId(null);
  }, [selected]);
  const index = selected < 0 ? events.length - 1 : selected;
  const active = events[index];
  const markers = new Map<number, number>();
  for (const event of events)
    markers.set(event.frameIndex, (markers.get(event.frameIndex) ?? 0) + 1);
  const x = (frameIndex: number) => ((180 - view.frames.length + frameIndex + 0.5) * 300) / 180;
  // Keep a focused rail reachable until Tab/blur if its last event ages out.
  if (!active && !focused) return null;
  const description = active
    ? `${active.label || "Untitled event"} · ${eventPosition(active)}${active.detail ? ` · ${active.detail}` : ""}`
    : "No events in displayed frames";
  return (
    <div
      class={`peer/rail relative ${compact ? "-mt-1.5" : "-mt-3"}`}
      data-event-rail
      data-reading={!compact && (selected >= 0 || focused) ? "" : undefined}
    >
      <div class="flex gap-1">
        <svg
          viewBox="0 0 300 16"
          preserveAspectRatio="none"
          class={`block min-w-0 flex-1 overflow-visible ${compact ? "h-3" : "focus-ring h-6 cursor-crosshair"}`}
          {...(compact
            ? {
                role: "img",
                "aria-label": `Events in displayed frames: ${events.length}`,
              }
            : {
                role: "slider",
                tabindex: 0,
                "aria-label": "Inspect events",
                "aria-valuemin": 0,
                "aria-valuemax": Math.max(0, events.length - 1),
                "aria-valuenow": Math.max(0, index),
                "aria-valuetext": active
                  ? `Event ${index + 1} of ${events.length}: ${description}`
                  : description,
                "aria-disabled": !active,
                "aria-describedby": hintId,
              })}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setInspectedId(null);
          }}
          onPointerMove={(event) => {
            if (compact || !events.length) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const pointer = ((event.clientX - bounds.left) / bounds.width) * 300;
            const closest = events.reduce((best, item) =>
              Math.abs(x(item.frameIndex) - pointer) < Math.abs(x(best.frameIndex) - pointer)
                ? item
                : best,
            );
            setInspectedId(closest.id);
          }}
          onPointerLeave={() => {
            if (!focused) setInspectedId(null);
          }}
          onKeyDown={(event) => {
            if (
              compact ||
              !events.length ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.isComposing
            )
              return;
            const next =
              event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? index - 1
                : event.key === "ArrowRight" || event.key === "ArrowUp"
                  ? index + 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? events.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            setInspectedId(events[Math.max(0, Math.min(events.length - 1, next))]?.id ?? null);
          }}
        >
          <title>Events in measured frame intervals</title>
          <line x1="0" x2="300" y1="8" y2="8" class="stroke-jank-divider" />
          {[...markers].map(([frameIndex, count]) => (
            <path
              key={view.frames[frameIndex]?.id}
              data-event-frame={view.frames[frameIndex]?.id}
              data-event-count={count}
              d={`M${x(frameIndex)},4l4,4l-4,4l-4,-4Z`}
              class={
                frameIndex === active?.frameIndex ? "fill-jank-text" : "fill-jank-text-secondary"
              }
            >
              <title>
                {count} {count === 1 ? "event" : "events"} in frame {view.frames[frameIndex]?.id}
              </title>
            </path>
          ))}
        </svg>
      </div>
      {!compact && (
        <>
          {(selected >= 0 || focused) && (
            <p
              data-event-readout
              class="truncate pt-1 text-label-12 text-jank-text-secondary"
              title={description}
            >
              ◆ {description}
            </p>
          )}
          <p id={hintId} class="sr-only">
            Left and right arrows browse each event, including events sharing a frame. Home and End
            select the first and last. Full details are in the Events disclosure. F toggles Freeze.
          </p>
        </>
      )}
    </div>
  );
}
