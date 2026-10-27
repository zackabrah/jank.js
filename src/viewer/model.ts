import { parseRecording } from "../core/recording.ts";

import {
  inspectFrame,
  recordingSummary,
  selectFrameRange,
} from "../core/inspection.ts";

import type { PerformanceRecording } from "../core/recording-types.ts";

/** UI-independent state. Each returned snapshot is detached from the loaded recording. */
export function createRecordingViewModel() {
  let recording: PerformanceRecording | null = null;

  let selected: number | null = null,
    range: { start: number; end: number } | null = null;

  function resetRange() {
    range = recording?.frames.length
      ? {
          start: recording.frames[0]!.at - recording.frames[0]!.interval,
          end: recording.frames.at(-1)!.at,
        }
      : null;
  }

  return {
    load(text: string) {
      const candidate = parseRecording(text);

      recording = candidate;

      selected = candidate.frames[0]?.id ?? null;

      resetRange();
    },
    clear() {
      recording = null;

      selected = null;

      range = null;
    },
    selectFrame(id: number) {
      if (!recording?.frames.some((frame) => frame.id === id))
        throw new RangeError("Frame is not in this recording");

      selected = id;
    },
    step(direction: -1 | 1) {
      if (!recording || selected === null) return;

      const index = recording.frames.findIndex(
        (frame) => frame.id === selected,
      );

      selected =
        recording.frames[
          Math.max(0, Math.min(recording.frames.length - 1, index + direction))
        ]?.id ?? null;
    },
    setRange(start: number, end: number) {
      if (!recording) throw new Error("Open a recording first");

      selectFrameRange(recording, start, end);

      range = { start, end };
    },
    resetRange,
    /** A detached copy of the validated recording, for views that draw every frame. */
    recording(): PerformanceRecording | null {
      return recording ? structuredClone(recording) : null;
    },
    snapshot(bucketCount = 240) {
      if (
        !Number.isInteger(bucketCount) ||
        bucketCount < 1 ||
        bucketCount > 1000
      )
        throw new RangeError("Timeline resolution must be 1–1000 buckets");

      if (!recording) return null;

      const visible = range
        ? selectFrameRange(recording, range.start, range.end)
        : recording.frames;

      const size = Math.max(1, Math.ceil(visible.length / bucketCount));

      const timeline: {
        start: number;
        end: number;
        meanMs: number;
        maxMs: number;
        frameId: number;
        frames: number;
      }[] = [];

      for (let i = 0; i < visible.length; i += size) {
        const group = visible.slice(i, i + size),
          first = group[0]!,
          last = group.at(-1)!;

        const peak = group.reduce((a, b) => (a.interval >= b.interval ? a : b));

        timeline.push({
          start: first.at - first.interval,
          end: last.at,
          meanMs:
            group.reduce((sum, frame) => sum + frame.interval, 0) /
            group.length,
          maxMs: peak.interval,
          frameId: peak.id,
          frames: group.length,
        });
      }

      const frameIds = new Set(recording.frames.map((frame) => frame.id));

      return structuredClone({
        summary: recordingSummary(recording),
        metadata: recording.metadata,
        budget: recording.budget,
        capture: recording.capture,
        overhead: recording.overhead,
        range,
        selected: selected === null ? null : inspectFrame(recording, selected),
        timeline,
        frameIds: recording.frames.map((frame) => frame.id),
        unlinkedGpuSamples:
          recording.gpu?.samples.filter(
            (sample) =>
              sample.diagnosticFrame == null ||
              !frameIds.has(sample.diagnosticFrame),
          ).length ?? 0,
      });
    },
  };
}

export type RecordingViewModel = ReturnType<typeof createRecordingViewModel>;

export type RecordingViewerState = NonNullable<
  ReturnType<RecordingViewModel["snapshot"]>
>;
