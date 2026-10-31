import { summarizeGpuCoverage } from "../analysis/gpu-coverage.ts";
import { finalizeRecording, type RecordingFinalization } from "../browser/finalize-recording.ts";
import type { GpuFrameResolver } from "../core/gpu.ts";
import type { Profiler } from "../profiler.ts";
import type { Recording } from "../recordings/recording.ts";
import { gpuCoverageText } from "./capture-description.ts";

interface ExportOptions {
  readonly profiler: Profiler;
  readonly resolver?: GpuFrameResolver;
  readonly timeoutMs?: number;
  readonly save: (recording: Recording) => void;
  readonly changed: () => void;
}
interface SelectedRecording {
  readonly id: number | null;
  readonly recording: Recording;
}

/** Panel-owned asynchronous export, one retry copy and bounded per-capture notices. No host loop ownership. */
export function createRecordingExporter(options: ExportOptions) {
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 10000) {
    throw new RangeError("exportTimeoutMs must be an integer from 0 to 10000");
  }
  const { profiler } = options;
  const notices = new Map<number, string>();
  let cached: SelectedRecording | null = null;
  let retryRecent = false;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let message = "";

  function readCapture(id: number): SelectedRecording {
    const recording = profiler.capture.read(id);
    if (!recording) {
      throw new Error("This capture is no longer retained.");
    }
    return cached?.id === id ? cached : { id, recording };
  }
  function select(id?: number): SelectedRecording {
    if (id !== undefined) {
      return readCapture(id);
    }
    // Stop first: exporting while recording must never choose an older saved capture.
    const stopped = profiler.capture.stop();
    const latest = profiler.capture.list().at(-1);
    if (stopped) {
      return { id: latest?.id ?? null, recording: stopped };
    }
    if (latest) {
      return readCapture(latest.id);
    }
    return retryRecent && cached?.id === null
      ? cached
      : { id: null, recording: profiler.capture.recent() };
  }
  function describe(id: number | null, text: string): void {
    message = `${id === null ? "Recent history" : `Capture #${id}`}: ${text}`;
    const retained = new Set(profiler.capture.list().map((capture) => capture.id));
    for (const key of notices.keys()) {
      if (!retained.has(key)) {
        notices.delete(key);
      }
    }
    if (id !== null && retained.has(id)) {
      notices.set(id, message);
    }
  }
  function clear(): void {
    generation += 1;
    busy = false;
    message = "";
    cached = null;
    retryRecent = false;
    notices.clear();
  }
  function current(epoch: number): boolean {
    return !disposed && epoch === generation;
  }
  function finish(selected: SelectedRecording, result: RecordingFinalization | null): void {
    if (
      selected.id !== null &&
      !profiler.capture.list().some((capture) => capture.id === selected.id)
    ) {
      describe(null, "Capture cleared or evicted; export cancelled.");
      return;
    }
    const recording = result?.recording ?? selected.recording;
    const description = describeResult(recording, result);
    cached = { id: selected.id, recording };
    retryRecent = selected.id === null;
    options.save(recording);
    retryRecent = false;
    describe(selected.id, `Download requested. ${description}`);
  }
  async function exportRecording(id?: number): Promise<void> {
    if (disposed || busy) {
      return;
    }
    const selected = select(id);
    const epoch = ++generation;
    busy = true;
    describe(
      selected.id,
      options.resolver
        ? `Finalizing GPU results (up to ${timeoutMs} ms)…`
        : "Preparing captured data…",
    );
    options.changed();
    await completeExport(selected, epoch);
  }
  async function completeExport(selected: SelectedRecording, epoch: number): Promise<void> {
    try {
      const result = options.resolver
        ? await finalizeRecording(selected.recording, options.resolver, { timeoutMs })
        : null;
      if (current(epoch)) {
        finish(selected, result);
      }
    } catch (error) {
      if (current(epoch)) {
        describe(selected.id, "Download failed; captured data retained for retry.");
        throw error;
      }
    } finally {
      if (current(epoch)) {
        busy = false;
        options.changed();
      }
    }
  }
  return {
    export: exportRecording,
    state: () => ({ busy, message }),
    notice: (id: number) => notices.get(id) ?? "",
    clear,
    dispose: () => {
      disposed = true;
      clear();
    },
  };
}

function describeResult(recording: Recording, result: RecordingFinalization | null): string {
  const outcomes = {
    settled: "GPU finalization settled.",
    timeout: "GPU finalization timed out; available results exported.",
    cancelled: "GPU finalization cancelled; available results exported.",
    unavailable: "GPU finalization unavailable; available results exported.",
    error: `GPU finalization failed: ${result?.error ?? "unknown error"}. Available results exported.`,
  };
  const outcome = result
    ? outcomes[result.status]
    : "No GPU resolver connected; pending results were not finalized.";
  const coverage = result?.coverage ?? summarizeGpuCoverage(recording);
  const omitted = result?.omittedSamples ?? 0;
  const truncation = recording.truncated ? " Recording marked truncated." : "";
  return `${outcome} ${gpuCoverageText(coverage)} ${omitted} merge samples omitted.${truncation} Only sealed host frames are exported. Duration-only GPU samples do not establish interval coverage.`;
}

export type RecordingExporter = ReturnType<typeof createRecordingExporter>;
