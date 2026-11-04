import { formatMs } from "../format.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { GpuCoveragePopover } from "./coverage-popover.tsx";
import type { RecordingInspection } from "./inspection.ts";

export function RecordingSummary({
  recording,
  summary,
  onInspect,
}: {
  recording: PerformanceRecording;
  summary: RecordingInspection;
  onInspect: (index: number) => void;
}) {
  const count = recording.frames.length;
  return (
    <dl
      aria-label="Recording summary"
      class="grid shrink-0 grid-cols-5 divide-x divide-jank-divider border-b border-jank-divider bg-jank-surface [&>div]:min-w-0 [&>div]:px-6 [&>div]:py-2"
    >
      <div>
        <dt class="text-label-12 text-jank-text-secondary">Over budget</dt>
        <dd class="mt-1 font-mono text-label-20">
          {summary.overCount} <span class="text-label-12 text-jank-text-secondary">/ {count}</span>
        </dd>
        <dd class="font-mono text-label-12 text-jank-text-secondary">
          {count ? `${((summary.overCount / count) * 100).toFixed(1)}%` : "No frames"}
        </dd>
      </div>
      <div>
        <dt class="text-label-12 text-jank-text-secondary">Worst frame</dt>
        <dd
          data-over={summary.worst && summary.worst.interval > summary.overLimit ? "" : undefined}
          class="mt-1 font-mono text-label-20 data-over:text-jank-over"
        >
          {summary.worst ? (
            <>
              <span>{formatMs(summary.worst.interval)}</span>
              <span class="block text-label-12">
                f{summary.worst.id}
                {summary.spikes.length > 0 && " · ▲1"}
              </span>
            </>
          ) : (
            "Unknown"
          )}
        </dd>
      </div>
      <div>
        <dt class="text-label-12 text-jank-text-secondary">p95 frame</dt>
        <dd
          data-over={summary.p95 !== null && summary.p95 > summary.overLimit ? "" : undefined}
          class="mt-1 font-mono text-label-20 data-over:text-jank-over"
        >
          {summary.p95 === null ? "Unknown" : formatMs(summary.p95)}
          {summary.displayPacedMs !== null && (
            <span class="block text-label-12 text-jank-text-secondary">
              Display-paced at {formatMs(summary.displayPacedMs)}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt class="text-label-12 text-jank-text-secondary">Detected spikes</dt>
        <dd class="mt-1 font-mono text-label-20">{summary.spikes.length}</dd>
        <dd class="text-label-12 text-jank-text-secondary">
          over {formatMs(summary.spikeThreshold)} (2× budget)
        </dd>
      </div>
      <div>
        <dt class="text-label-12 text-jank-text-secondary">GPU coverage</dt>
        <dd class="mt-1 flex flex-wrap items-baseline justify-between gap-1 font-mono text-label-20">
          <span>
            {!count
              ? "No frames"
              : !recording.gpuTiming
                ? recording.gpu
                  ? "Unknown"
                  : "Not recorded"
                : `${(Math.floor((summary.gpu.complete / count) * 1000) / 10).toFixed(1)}%`}
          </span>
          <GpuCoveragePopover recording={recording} summary={summary} onInspect={onInspect} />
        </dd>
        <dd class="text-label-12 text-jank-text-secondary">complete frame records</dd>
      </div>
    </dl>
  );
}
