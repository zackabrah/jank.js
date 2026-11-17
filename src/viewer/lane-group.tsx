import { useState } from "preact/hooks";
import { withUnit } from "../format.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { Button } from "../ui/button.tsx";
import { LaneRow } from "./lane-row.tsx";
import type { recordingLanes, TimingLane } from "./lanes.ts";
import type { ViewerSelection } from "./selection.ts";

export function LaneGroup({
  label,
  lanes,
  model,
  recording,
  selection,
  onSelect,
  expand,
}: {
  label: string;
  lanes: TimingLane[];
  model: ReturnType<typeof recordingLanes>;
  recording: PerformanceRecording;
  selection: ViewerSelection;
  onSelect: (index: number) => void;
  expand: boolean;
}) {
  const [page, setPage] = useState(0);
  const gpu = label === "GPU passes";
  const pages = Math.ceil(lanes.length / 16);
  return (
    <section aria-label={label} class="mt-3">
      <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-label-12">
        <h3 class="m-0 text-label-13 font-medium">{label}</h3>
        <span class="font-mono text-jank-text-secondary">
          0–{withUnit(gpu ? model.gpuCeiling : model.cpuCeiling, "ms")} ·{" "}
          {gpu ? "GPU clock, separate scale" : "shared CPU scale"}
        </span>
      </div>
      {pages > 1 && (
        <div class="mb-2 flex items-center justify-end gap-2 text-label-12">
          <span>
            {page * 16 + 1}–{Math.min((page + 1) * 16, lanes.length)} of {lanes.length} lanes
          </span>
          <Button compact onPress={() => setPage(Math.max(0, page - 1))}>
            Previous lanes
          </Button>
          <Button compact onPress={() => setPage(Math.min(pages - 1, page + 1))}>
            Next lanes
          </Button>
        </div>
      )}
      {lanes.length ? (
        lanes
          .slice(page * 16, (page + 1) * 16)
          .map((lane) => (
            <LaneRow
              key={lane.id}
              lane={lane}
              model={model}
              recording={recording}
              selection={selection}
              onSelect={onSelect}
              expand={expand}
            />
          ))
      ) : (
        <p class="py-2 text-copy-13 text-jank-text-secondary">
          {gpu
            ? "No per-invocation GPU timings retained. Legacy aggregates cannot populate pass lanes."
            : "No CPU scope lanes retained; scope coverage is shown in the frame inspector."}
        </p>
      )}
    </section>
  );
}
