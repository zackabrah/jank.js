import { useState } from "preact/hooks";
import { NBSP, withUnit } from "../format.ts";
import { MeasurementValue } from "../measurement-value.tsx";
import { IconButton } from "../ui/button.tsx";
import { Notice } from "../ui/notice.tsx";
import type { LiveView } from "./model.ts";

export function OverheadFooter({ view }: { view: LiveView }) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <footer class="flex h-7 items-center justify-between gap-1 border-t border-jank-divider px-3 text-label-12">
        <p>
          Overhead{" "}
          <span class="font-mono">
            <MeasurementValue measurement={view.overhead.mean} precision={2} />
          </span>
          {NBSP}ms avg ·{" "}
          <span class="font-mono">
            <MeasurementValue measurement={view.overhead.peak} precision={2} />
          </span>{" "}
          peak
        </p>
        <IconButton
          compact
          label="How measurements are calculated"
          pressed={help}
          onPress={() => setHelp((value) => !value)}
        >
          <svg
            viewBox="0 0 16 16"
            class="size-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v4M8 4.5v1" />
          </svg>
        </IconButton>
      </footer>
      {help && (
        <div class="p-3">
          <Notice>
            <p>
              CPU scopes are inclusive and may overlap. Unattributed time includes waiting and
              untracked work. Only complete scope frames contribute to CPU averages.
            </p>
            <p class="mt-2">
              FPS counts frame endings over one second. Other KPIs use the last {view.frames.length}{" "}
              frames. Without display pacing, a frame is over budget when it runs more than{" "}
              {withUnit(view.tolerance.toFixed(2), "ms")} past the budget, the larger of 1 ms or 5%,
              so normal frame-time jitter doesn't count.
            </p>
            <p class="mt-2">
              Collection <MeasurementValue measurement={view.overhead.collection} precision={3} />{" "}
              ms/frame; UI <MeasurementValue measurement={view.overhead.refresh} precision={3} />{" "}
              ms/frame. Synchronous work only; deferred layout, paint and GPU work are excluded.
            </p>
            <p class="mt-2">
              With focus in the panel: R records, A arms auto-capture, F freezes, M changes view.
            </p>
          </Notice>
        </div>
      )}
    </>
  );
}
