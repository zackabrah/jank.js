import type { RefObject } from "preact";
import { ChevronIcon } from "../ui/icons.tsx";

export function ViewerShortcuts({
  detailsRef,
}: {
  detailsRef: RefObject<HTMLDetailsElement | null>;
}) {
  return (
    <details
      ref={detailsRef}
      class="group relative"
      onKeyDown={(event) => {
        if (!event.currentTarget.open) return;
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary class="focus-ring flex cursor-pointer items-center gap-1.5 rounded-md border border-jank-divider px-2 py-1 text-jank-text">
        <ChevronIcon class="group-open:rotate-90" />
        Shortcuts ?
      </summary>
      <div class="absolute right-0 bottom-full z-20 mb-2 w-80 space-y-2 rounded-md border border-jank-divider bg-jank-surface p-3 shadow-lg">
        <h2 class="m-0 text-heading-14">Viewer shortcuts</h2>
        <p>← / → · previous / next frame. Home / End · first / last frame.</p>
        <p>J / K · previous / next slow frame. W · worst frame.</p>
        <p>
          Drag between the overview handles to slide the window. Drag a handle to resize it; focus a
          handle and use arrow keys for precise changes.
        </p>
        <p>
          Hover or focus a lane to inspect it. Expand quiet lanes changes their height explicitly.
        </p>
        <p>? · show this help. Escape · close help. Shortcuts are paused while editing fields.</p>
      </div>
    </details>
  );
}
