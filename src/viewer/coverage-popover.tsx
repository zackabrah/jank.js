import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PerformanceRecording } from "../recording/types.ts";
import { Button, IconButton } from "../ui/button.tsx";
import { GpuCoverageBar } from "../ui/gpu-coverage.tsx";
import { DismissIcon } from "../ui/icons.tsx";
import type { RecordingInspection } from "./inspection.ts";

export function GpuCoveragePopover({
  recording,
  summary,
  onInspect,
}: {
  recording: PerformanceRecording;
  summary: RecordingInspection;
  onInspect: (index: number) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const node = popover.current;
    if (!node) return;
    node.setAttribute("popover", "auto");
    const toggle = () => setOpen(node.matches(":popover-open"));
    node.addEventListener("toggle", toggle);
    return () => node.removeEventListener("toggle", toggle);
  }, []);
  const close = (focus = true) => {
    popover.current?.hidePopover();
    if (focus) trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-controls={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        class="focus-ring rounded-xs text-label-13 text-jank-focus underline"
        onClick={() => {
          const node = popover.current;
          if (!node || !trigger.current) return;
          if (node.matches(":popover-open")) {
            close();
            return;
          }
          node.style.top = `${trigger.current.getBoundingClientRect().bottom + 8}px`;
          setPage(0);
          node.showPopover();
          node.querySelector<HTMLButtonElement>("button")?.focus();
        }}
      >
        Why?
      </button>
      <div
        ref={popover}
        id={id}
        role="dialog"
        aria-label="GPU coverage explanation"
        class="fixed right-6 bottom-auto left-auto m-0 max-h-[min(28rem,70dvh)] w-90 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border border-jank-divider bg-jank-surface p-4 font-sans text-label-13 font-normal text-jank-text shadow-lg"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-heading-14">GPU coverage</h2>
          <IconButton label="Close GPU coverage" onPress={() => close()}>
            <DismissIcon />
          </IconButton>
        </div>
        <GpuCoverageBar coverage={summary.gpu} />
        <p class="py-2 text-label-12 text-jank-text-secondary">
          {summary.complete} of {recording.frames.length} CPU frames have complete scope records.
          GPU coverage is never inferred from CPU timing. Complete includes explicit empty GPU
          frames.
          {!recording.gpuTiming &&
            recording.gpu &&
            " Legacy summaries cannot establish per-frame invocation coverage."}
          {!recording.gpuTiming && !recording.gpu && " No GPU evidence was supplied."}
        </p>
        {summary.gpuProblems.length > 0 && (
          <>
            <p class="py-2 text-label-12">
              Inspect recorded causes · {summary.gpuProblems.length} frames
            </p>
            <ul class="m-0 list-none space-y-2 p-0">
              {summary.gpuProblems
                .slice(page * 20, (page + 1) * 20)
                .map(({ index, record, coverage }) => (
                  <li key={record.frameId}>
                    <button
                      type="button"
                      class="focus-ring w-full rounded-xs text-left text-jank-focus underline"
                      onClick={() => {
                        close(false);
                        onInspect(index);
                      }}
                    >
                      f{record.frameId} ·{" "}
                      {coverage.completeness === "unknown" ? "unknown inventory" : "incomplete"}
                      <span class="block text-label-12 text-jank-text-secondary">
                        {coverage.pending} pending · {coverage.rejected} rejected ·{" "}
                        {coverage.omitted} omitted
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
            {summary.gpuProblems.length > 20 && (
              <div class="mt-2 flex items-center justify-between gap-2">
                <Button onPress={() => setPage(Math.max(0, page - 1))}>Previous causes</Button>
                <span>
                  {page + 1} / {Math.ceil(summary.gpuProblems.length / 20)}
                </span>
                <Button
                  onPress={() =>
                    setPage(Math.min(Math.ceil(summary.gpuProblems.length / 20) - 1, page + 1))
                  }
                >
                  Next causes
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
