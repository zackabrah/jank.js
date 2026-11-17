import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { formatSeconds, NBSP, withUnit } from "../format.ts";
import { summarizeRecording } from "../recording/summary.ts";
import { Button } from "../ui/button.tsx";
import { CapacityMeter } from "../ui/capacity-meter.tsx";
import { DisclosureSection } from "../ui/disclosure-section.tsx";
import { GpuCoverageBar } from "../ui/gpu-coverage.tsx";
import { Notice } from "../ui/notice.tsx";
import { AutomaticCaptureCard } from "./automatic-view.tsx";
import { BufferCoverage, GpuPoolCapacity } from "./buffer-view.tsx";
import type { CaptureConnection, CaptureState, SavedCapture } from "./controller.ts";
import { Instrumentation } from "./instrumentation.tsx";
import type { ReadInstrumentation } from "./instrumentation-model.ts";
import { CaptureActions, CaptureSummary } from "./saved-capture.tsx";

export function CaptureView({
  connection,
  state,
  budget,
  onOpen,
  onExport,
  onEditRule,
  instrumentation,
  onInstrumentationError,
}: {
  connection: CaptureConnection;
  state: CaptureState;
  budget: number;
  onOpen: (capture: SavedCapture) => void;
  onExport: (capture: SavedCapture) => void;
  onEditRule: () => void;
  instrumentation?: ReadInstrumentation | undefined;
  onInstrumentationError: (message: string) => void;
}) {
  const reasonId = useId();
  const recordReason = connection.controller.recordingUnavailable();
  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<"save" | "discard" | null>(null);
  useLayoutEffect(() => {
    if (!focusAfter.current || state.phase === "finalizing") return;
    const saved = focusAfter.current === "save" && state.phase === "idle" ? state.saved[0] : null;
    root.current
      ?.querySelector<HTMLButtonElement>(
        saved
          ? `[aria-label="Capture C${saved.id}"] button`
          : '[aria-label="Manual recording"] button',
      )
      ?.focus();
    focusAfter.current = null;
  }, [state]);
  const { controller } = connection;
  const buffers = controller.getBuffers();
  const phase = state.kind === "automatic" && state.phase === "recording" ? "idle" : state.phase;
  const armed = state.automatic !== null && state.automatic.state !== "off";
  const automatic = (
    <AutomaticCaptureCard
      controller={controller}
      state={state}
      budget={budget}
      onEditRule={onEditRule}
    />
  );
  const remaining = state.capacity - state.frames;
  const recordingCoverage = buffers.recordingGpu ? (
    <GpuCoverageBar coverage={buffers.recordingGpu} label="Recording GPU coverage" compact />
  ) : (
    <p class="py-2 text-label-12 text-jank-text-secondary">
      Recording GPU coverage unavailable; the host has not supplied the full recording window and
      its GPU coverage.
    </p>
  );
  return (
    <div ref={root} class="h-full space-y-3 overflow-y-auto overscroll-contain p-3 text-copy-13">
      {phase === "idle" && automatic}
      <section
        aria-label="Manual recording"
        data-recording={phase === "recording" ? "" : undefined}
        class="space-y-2 rounded-md border border-jank-divider bg-jank-surface p-3 data-recording:border-red-400 data-recording:bg-red-100"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-heading-14">
            {phase === "idle" ? (
              "Manual recording"
            ) : (
              <>
                <span aria-hidden="true" class="mr-1 text-jank-rec-text">
                  ●
                </span>
                {phase === "recording"
                  ? "Recording"
                  : phase === "finalizing"
                    ? "Finalizing GPU"
                    : "Stopped · not saved"}
              </>
            )}
          </h2>
          {phase === "idle" ? (
            <Button
              compact
              onPress={controller.start}
              unavailable={
                recordReason
                  ? { reason: recordReason, reasonId, onExplain: controller.start }
                  : undefined
              }
            >
              <span aria-hidden="true" class="text-jank-rec-text">
                ●
              </span>
              Start recording
            </Button>
          ) : (
            <span class="shrink-0 font-mono text-label-12">
              {formatSeconds(state.elapsedMs / 1000)} ·{" "}
              {withUnit(state.frames.toLocaleString(), "f")}
            </span>
          )}
        </div>
        {recordReason && (
          <p id={reasonId} class="text-label-12 text-jank-text-secondary">
            {recordReason}
          </p>
        )}
        {phase === "idle" ? (
          <p class="text-label-12 text-jank-text-secondary">
            ≈{NBSP}
            {formatSeconds((state.capacity * budget) / 1000)} at{" "}
            {withUnit((1000 / budget).toFixed(0), "FPS")} · up to {state.capacity.toLocaleString()}{" "}
            frames
            {armed && (
              <>
                {" "}
                · <span class="text-jank-capture">disarms auto-capture</span>
              </>
            )}
          </p>
        ) : (
          <>
            <CapacityMeter label="Recording capacity" used={state.frames} total={state.capacity} />
            <div class="flex justify-between gap-2 text-label-12 text-jank-text-secondary">
              <span>
                ≈{NBSP}
                {formatSeconds((remaining * budget) / 1000)} left at{" "}
                {withUnit((1000 / budget).toFixed(0), "FPS")}
              </span>
            </div>
            {buffers.pool && <GpuPoolCapacity pool={buffers.pool} />}
            {recordingCoverage}
            {phase === "finalizing" && (
              <p role="status" class="text-label-12 text-jank-text-secondary">
                Waiting up to 500 ms for pending GPU queries. The captured frame window is fixed.
              </p>
            )}
            <div class="flex gap-2">
              {phase !== "finalizing" && (
                <Button
                  variant="primary"
                  onPress={() => {
                    focusAfter.current = "save";
                    controller.stopAndSave();
                  }}
                >
                  <span aria-hidden="true" class="mr-1">
                    ■
                  </span>
                  {state.phase === "unsaved" ? "Retry save" : "Stop and save"}
                </Button>
              )}
              <Button
                onPress={() => {
                  focusAfter.current = "discard";
                  controller.discard();
                }}
              >
                Discard
              </Button>
            </div>
            <p class="text-label-12 text-jank-text-secondary">
              Stops and saves at capacity. Freeze only holds the live display.
            </p>
          </>
        )}
      </section>
      {phase !== "idle" && automatic}
      {state.kind === "automatic" && state.phase === "recording" && (
        <section aria-label="Recording so far">
          <CapacityMeter label="Recording capacity" used={state.frames} total={state.capacity} />
          {recordingCoverage}
        </section>
      )}
      <BufferCoverage buffers={buffers} />
      <DisclosureSection
        key={state.saved[0]?.id ?? 0}
        title={`Saved captures · ${state.saved.length}`}
        summary="latest 10 kept"
        defaultOpen
      >
        {state.saved[0]?.recording.gpuTiming && (
          <GpuCoverageBar
            coverage={summarizeRecording(state.saved[0].recording).gpu}
            label={`Capture C${state.saved[0].id} GPU coverage`}
          />
        )}
        {state.saved.length === 0 && (
          <p class="py-2 text-jank-text-secondary">No saved captures yet.</p>
        )}
        <ul class="m-0 list-none divide-y divide-jank-divider p-0">
          {state.saved.map((capture) => (
            <li
              key={capture.id}
              aria-label={`Capture C${capture.id}`}
              class="flex items-center gap-2 py-2"
            >
              <strong
                class={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-current font-mono text-label-12 ${capture.recording.capture.mode === "automatic" ? "text-jank-capture" : "text-jank-rec-text"}`}
                title={`${capture.recording.capture.mode === "automatic" ? "Automatic" : "Manual"} capture C${capture.id}`}
              >
                <span class="min-w-0 truncate">C{capture.id}</span>
              </strong>
              <CaptureSummary capture={capture} />
              <CaptureActions capture={capture} onOpen={onOpen} onExport={onExport} />
            </li>
          ))}
        </ul>
        <p class="py-2 text-label-12 text-jank-text-secondary">
          Memory only, latest 10 kept; the 11th removes the oldest. Closing the panel keeps them
          while the collector is alive. Reloading clears them. Export to keep a recording.
        </p>
        {state.saved.length === 10 && (
          <Notice tone="warning">
            The next save removes C{state.saved.at(-1)?.id}, the oldest.
          </Notice>
        )}
      </DisclosureSection>
      <Instrumentation source={instrumentation} onError={onInstrumentationError} />
    </div>
  );
}
