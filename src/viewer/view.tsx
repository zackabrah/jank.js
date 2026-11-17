import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { type ComparisonBundle, serializeComparison } from "../compare/model.ts";
import { formatMs, formatSeconds, withUnit } from "../format.ts";
import { downloadJson, downloadRecording } from "../recording/download.ts";
import { MAX_RECORDING_BYTES } from "../recording/format.ts";
import { summarizeRecording } from "../recording/summary.ts";
import type { PerformanceRecording } from "../recording/types.ts";
import { Button } from "../ui/button.tsx";
import { Notice } from "../ui/notice.tsx";
import { ComparisonViewer } from "./comparison.tsx";
import { MAX_PINNED_COUNTERS } from "./counter-details.tsx";
import { parseViewerDocument } from "./document.ts";
import { inspectRecording } from "./inspection.ts";
import { Inspector, type InspectorTab } from "./inspector.tsx";
import { recordingCounters, scopeMedians } from "./inspector-model.ts";
import { recordingLanes } from "./lanes.ts";
import { RecordingOverview } from "./overview.tsx";
import { fitSelection, selectFrame, zoomSelection } from "./selection.ts";
import { ViewerShortcuts } from "./shortcuts.tsx";
import { RecordingSummary } from "./summary.tsx";
import { RecordingTimeline } from "./timeline.tsx";

export function RecordingViewer({
  initial,
  name = "Recording",
  onClose,
}: {
  initial?: PerformanceRecording | ComparisonBundle | undefined;
  name?: string;
  onClose?: (() => void) | undefined;
}) {
  const initialRecording = initial?.format === "jank.js-recording" ? initial : undefined;
  const [current, setCurrent] = useState(() => (initial ? { data: initial, name, id: 0 } : null));
  const [selection, setSelection] = useState(() =>
    fitSelection(
      initialRecording?.frames.length ?? 0,
      initialRecording ? summarizeRecording(initialRecording).initialIndex : 0,
    ),
  );
  const { selected, start, end } = selection;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<InspectorTab>("Frame");
  const [pins, setPins] = useState<string[]>([]);
  const help = useRef<HTMLDetailsElement>(null);
  const request = useRef(0);
  useLayoutEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const input = useRef<HTMLInputElement>(null);
  const recording = current?.data.format === "jank.js-recording" ? current.data : undefined;
  const comparison = current?.data.format === "jank.js-comparison" ? current.data : undefined;
  const summary = useMemo(() => (recording ? inspectRecording(recording) : null), [recording]);
  const lanes = useMemo(() => (recording ? recordingLanes(recording) : null), [recording]);
  const counters = useMemo(() => (recording ? recordingCounters(recording) : null), [recording]);
  const medians = useMemo(
    () => (recording && lanes ? scopeMedians(recording, lanes) : new Map<string, number>()),
    [recording, lanes],
  );
  const pin = (id: string) =>
    setPins((current) =>
      current.includes(id)
        ? current.filter((key) => key !== id)
        : current.length < MAX_PINNED_COUNTERS &&
            counters?.counters.some((counter) => counter.id === id && counter.numeric)
          ? [...current, id]
          : current,
    );
  const frame = recording?.frames[selected];
  const count = recording?.frames.length ?? 0;
  const slow = summary?.slowIndices ?? [];
  const selectedSpike = summary?.spikes.find((spike) => spike.index === selected);
  const inspector = useRef<HTMLElement>(null);
  const inspectGpu = useRef(false);
  useLayoutEffect(() => {
    if (!inspectGpu.current || tab !== "Frame") return;
    inspectGpu.current = false;
    inspector.current
      ?.querySelector<HTMLElement>(
        `[data-gpu-evidence="${recording?.frames[selection.selected]?.id}"]`,
      )
      ?.focus();
  }, [selection, recording, tab]);
  const load = async (file: File) => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      if (file.size > MAX_RECORDING_BYTES) throw new Error("File exceeds the 32 MiB import limit.");
      const next = parseViewerDocument(await file.text());
      if (id !== request.current) return;
      setCurrent({ data: next, name: file.name, id });
      setTab("Frame");
      setPins([]);
      setSelection(
        next.format === "jank.js-recording"
          ? fitSelection(next.frames.length, summarizeRecording(next).initialIndex)
          : fitSelection(0, 0),
      );
    } catch (cause) {
      const reason =
        cause instanceof Error
          ? cause.message.replace(
              /^Invalid (recording|comparison): (.+)$/,
              "It isn't a valid jank.js $1: `$2` is missing or wrong.",
            )
          : "Could not read the recording.";
      if (id === request.current)
        setError(`Couldn't open ${file.name}. ${reason.endsWith(".") ? reason : `${reason}.`}`);
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  const move = (index: number) => setSelection((state) => selectFrame(state, index, count));
  const stepSlow = (direction: -1 | 1) => {
    const index =
      direction < 0
        ? slow.findLast((index) => index < selected)
        : slow.find((index) => index > selected);
    if (index !== undefined) move(index);
  };
  const zoom = (factor: number) => setSelection((state) => zoomSelection(state, factor, count));
  return (
    <main
      class="flex h-full min-h-0 min-w-240 flex-col bg-jank-page text-jank-text"
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          !recording?.frames.length ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.isComposing ||
          (event.target as Element).closest("input, select, textarea, [contenteditable]")
        )
          return;
        if (event.key === "?" && help.current) {
          event.preventDefault();
          help.current.open = true;
          help.current.querySelector("summary")?.focus();
          return;
        }
        if (event.shiftKey) return;
        const key = event.key.toLowerCase();
        if (
          (key === "arrowup" || key === "arrowdown") &&
          (event.target as Element).getAttribute("role") !== "slider"
        )
          return;
        if (
          ![
            "arrowleft",
            "arrowright",
            "arrowup",
            "arrowdown",
            "home",
            "end",
            "w",
            "j",
            "k",
          ].includes(key)
        )
          return;
        event.preventDefault();
        if (key === "arrowleft" || key === "arrowdown") move(selected - 1);
        else if (key === "arrowright" || key === "arrowup") move(selected + 1);
        else if (key === "home") move(0);
        else if (key === "end") move(count - 1);
        else if (key === "j") stepSlow(-1);
        else if (key === "k") stepSlow(1);
        else move(summary?.worstIndex ?? 0);
      }}
    >
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-jank-divider px-6 py-2">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 class="m-0 text-heading-14">
            {comparison ? "Comparison viewer" : "Recording viewer"}
          </h1>
          <p class="max-w-72 truncate text-copy-13 text-jank-text-secondary">
            {current?.name ?? "Local file, nothing uploaded"}
          </p>
          {recording && summary && (
            <p class="font-mono text-label-12 text-jank-text-secondary">
              {recording.frames.length.toLocaleString()} frames ·{" "}
              {formatSeconds(summary.durationMs / 1000, 2)} ·{" "}
              {withUnit(Number(recording.budget.targetFps.toFixed(1)), "FPS")} target
            </p>
          )}
          {comparison && (
            <span class="rounded-full bg-gray-100 px-2 py-0.5 text-label-12">A/B comparison</span>
          )}
        </div>
        <div class="flex shrink-0 gap-2">
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label="Open recording or comparison file"
            class="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void load(file);
            }}
          />
          <Button onPress={() => input.current?.click()}>Open file…</Button>
          {current && (
            <Button
              onPress={() => {
                try {
                  if (input.current) {
                    const filename = current.name.replace(/\.json$/i, "");
                    if (comparison)
                      downloadJson(
                        input.current.ownerDocument,
                        serializeComparison(comparison),
                        filename,
                      );
                    else if (recording)
                      downloadRecording(input.current.ownerDocument, recording, filename);
                  }
                  setError("");
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Export failed.");
                }
              }}
            >
              Export JSON
            </Button>
          )}
          {onClose && <Button onPress={onClose}>Close viewer</Button>}
        </div>
      </header>
      {loading && <Notice>Reading file…</Notice>}
      {error && (
        <Notice
          tone="error"
          onDismiss={() => {
            setError("");
            input.current?.parentElement?.querySelector<HTMLButtonElement>("button")?.focus();
          }}
        >
          {error}
          {current
            ? ` The current ${comparison ? "comparison" : "recording"} is still open: ${current.name}.`
            : ""}
        </Notice>
      )}
      {!current && (
        <Notice>
          Open a jank.js recording or comparison (.json, up to 32 MiB). Files stay in this browser.
        </Notice>
      )}
      {comparison && <ComparisonViewer key={current?.id} bundle={comparison} />}
      {recording && summary && lanes && counters && (
        <>
          <RecordingSummary
            key={current?.id}
            recording={recording}
            summary={summary}
            onInspect={(index) => {
              inspectGpu.current = true;
              setTab("Frame");
              move(index);
            }}
          />
          {!frame ? (
            <Notice>This recording contains no completed frames.</Notice>
          ) : (
            <>
              <RecordingOverview
                key={current?.id}
                recording={recording}
                summary={summary}
                selection={selection}
                onChange={setSelection}
                onSelect={move}
              />
              <nav
                aria-label="Recording navigation"
                class="flex shrink-0 flex-wrap items-center gap-2 border-b border-jank-divider px-6 py-2"
              >
                <Button onPress={() => move(selected - 1)}>Previous</Button>
                <span class="font-mono text-label-12">f{frame.id}</span>
                <Button onPress={() => move(selected + 1)}>Next</Button>
                <Button onPress={() => stepSlow(-1)}>
                  Previous slow <kbd>J</kbd>
                </Button>
                <span class="font-mono text-label-12 text-jank-over">
                  {selectedSpike
                    ? `▲${selectedSpike.rank} of ${summary.spikes.length}`
                    : `${summary.spikes.length} spikes`}
                </span>
                <Button onPress={() => stepSlow(1)}>
                  Next slow <kbd>K</kbd>
                </Button>
                <Button onPress={() => move(summary.worstIndex)}>Worst</Button>
                {summary.triggerIndex >= 0 && (
                  <Button onPress={() => move(summary.triggerIndex)}>Trigger</Button>
                )}
                <span
                  class="font-mono text-label-12 text-jank-text-secondary"
                  data-range-readout=""
                >
                  f{recording.frames[start]?.id} – f{recording.frames[end]?.id} · {end - start + 1}{" "}
                  {end === start ? "frame" : "frames"} ·{" "}
                  {(
                    ((recording.frames[end]?.at ?? 0) -
                      (recording.frames[start]?.at ?? 0) +
                      (recording.frames[start]?.interval ?? 0)) /
                    1000
                  ).toFixed(2)}
                  s
                </span>
                <div class="ml-auto flex gap-1">
                  <Button onPress={() => zoom(2)}>Zoom out</Button>
                  <Button onPress={() => zoom(0.5)}>Zoom in</Button>
                  <Button onPress={() => setSelection(fitSelection(count, selected))}>Fit</Button>
                </div>
              </nav>
              {/* Contain absolute accessibility labels within their scroll panes. */}
              <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,30%)]">
                <div class="relative min-h-0 overflow-y-auto overscroll-contain">
                  <RecordingTimeline
                    key={current?.id}
                    recording={recording}
                    selection={selection}
                    overLimit={summary.overLimit}
                    model={lanes}
                    counters={counters}
                    pins={pins}
                    onPin={pin}
                    onSelect={move}
                  />
                </div>
                <aside
                  ref={inspector}
                  aria-label="Frame inspector"
                  class="relative min-h-0 overflow-y-auto overscroll-contain border-l border-jank-divider"
                >
                  <Inspector
                    key={current?.id}
                    recording={recording}
                    frame={frame}
                    index={selected}
                    lanes={lanes}
                    medians={medians}
                    summary={summary}
                    counters={counters}
                    pins={pins}
                    onPin={pin}
                    tab={tab}
                    onTab={setTab}
                    name={current?.name ?? "Recording"}
                    onSelect={move}
                  />
                </aside>
              </div>
              <footer class="flex shrink-0 flex-wrap justify-between gap-2 border-t border-jank-divider px-6 py-1 text-label-12 text-jank-text-secondary">
                <p role="status">
                  Local file, nothing uploaded · Opened at{" "}
                  {summary.triggerIndex >= 0 ? "the trigger" : "the worst frame"} · selected f
                  {frame.id}
                </p>
                <p>
                  ← / → frame · Home / End · J / K slow &gt;{" "}
                  {formatMs(recording.budget.frameMs * 2)} · W worst
                </p>
                <ViewerShortcuts detailsRef={help} />
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
}
