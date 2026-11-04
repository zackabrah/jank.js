import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { CaptureConnection, SavedCapture } from "../capture/controller.ts";
import type { ReadInstrumentation } from "../capture/instrumentation-model.ts";
import { RuleEditor } from "../capture/rule-editor.tsx";
import { CaptureActions, CaptureSummary } from "../capture/saved-capture.tsx";
import { CaptureView } from "../capture/view.tsx";
import type { ComparisonController } from "../compare/controller.ts";
import type { ComparisonBundle } from "../compare/model.ts";
import { CompareTab } from "../compare/view.tsx";
import { LoadingTab } from "../loading/view.tsx";
import { downloadRecording } from "../recording/download.ts";
import { Button, IconButton } from "../ui/button.tsx";
import { DismissIcon } from "../ui/icons.tsx";
import { Notice } from "../ui/notice.tsx";
import { BudgetControl } from "./budget-control.tsx";
import { CompactMetrics, MiniContent } from "./compact-view.tsx";
import { LiveDetails } from "./details.tsx";
import { FullMetrics } from "./metrics.tsx";
import { ModeIcon } from "./mode-icon.tsx";
import { judgeBudget, type LiveView } from "./model.ts";
import { OverheadFooter } from "./overhead-footer.tsx";
import { captureState, type PanelMode, StateStrip } from "./state-strip.tsx";

export function LivePanel({
  view: latest,
  initialMode = "full",
  onBudgetChange,
  capture: captureConnection,
  instrumentation,
  comparison,
}: {
  view: LiveView;
  comparison?: ComparisonController | undefined;
  initialMode?: PanelMode | undefined;
  onBudgetChange?: ((milliseconds: number) => void) | undefined;
  capture?: CaptureConnection | undefined;
  instrumentation?: ReadInstrumentation | undefined;
}) {
  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [frozen, setFrozen] = useState<LiveView | null>(null);
  const surface = useRef<HTMLElement>(null);
  const tabsId = useId();
  const [tab, setTab] = useState("live");
  const [editingRule, setEditingRule] = useState(false);
  const wasEditing = useRef(false);
  useLayoutEffect(() => {
    if (wasEditing.current && !editingRule)
      surface.current?.querySelector<HTMLButtonElement>("[data-rule-edit] button")?.focus();
    wasEditing.current = editingRule;
  }, [editingRule]);
  const controller = captureConnection?.controller;
  const [comparisonState, setComparisonState] = useState(comparison?.getSnapshot());
  useLayoutEffect(() => {
    setComparisonState(comparison?.getSnapshot());
    return comparison?.subscribe(() => setComparisonState(comparison.getSnapshot()));
  }, [comparison]);
  const comparing = !!comparisonState && comparisonState.phase !== "idle";
  const comparisonProgress = comparing
    ? `${comparisonState.trial}/${comparisonState.bundle.plan.pairs * 2}`
    : undefined;
  const [captureProgress, setCaptureProgress] = useState(controller?.getSnapshot());
  const savedCapture = captureProgress?.saved[0];
  const savedId = savedCapture?.id;
  const [actionError, setActionError] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState("");
  const [dismissedComparison, setDismissedComparison] = useState<ComparisonBundle>();
  const comparisonError = comparisonState?.error ?? "";
  // A cancelled or failed run outranks every other notice (G9); validation errors stay by the plan.
  const comparisonInterruption =
    !comparing &&
    comparisonError &&
    comparisonState?.bundle !== dismissedComparison &&
    comparisonError === comparisonState?.bundle.reason &&
    (comparisonState.bundle.status === "interrupted" || comparisonState?.bundle.status === "failed")
      ? comparisonState.bundle.status
      : null;
  const message = captureProgress?.message ?? "";
  const error = actionError || captureProgress?.error;
  useEffect(() => {
    if (!message) setDismissedMessage("");
  }, [message]);
  const [dismissedCapture, setDismissedCapture] = useState<number>();
  useEffect(() => {
    if (savedId === undefined) return;
    let timeout: ReturnType<typeof setTimeout>;
    const dismiss = () => {
      // Keep the invoking control available while its viewer or keyboard focus is active.
      if (
        surface.current?.querySelector("[data-panel-notice]:focus-within") ||
        surface.current?.ownerDocument.querySelector("dialog[open]")
      ) {
        timeout = setTimeout(dismiss, 1000);
      } else setDismissedCapture(savedId);
    };
    timeout = setTimeout(dismiss, 8000);
    return () => clearTimeout(timeout);
  }, [savedId]);
  useLayoutEffect(() => {
    setCaptureProgress(controller?.getSnapshot());
    return controller?.subscribe(() => setCaptureProgress(controller.getSnapshot()));
  }, [controller]);
  const openCapture = (capture: SavedCapture) => {
    setActionError("");
    void Promise.resolve()
      .then(() => captureConnection?.onOpen(capture))
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : "Could not open the recording.");
      });
  };
  const exportCapture = (capture: SavedCapture) => {
    try {
      setActionError("");
      if (surface.current)
        downloadRecording(
          surface.current.ownerDocument,
          capture.recording,
          `capture-C${capture.id}`,
        );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not export the recording.");
    }
  };
  const recordingAfterFrame =
    captureProgress?.phase === "recording" && captureProgress.kind === "manual"
      ? captureProgress.afterFrameId
      : undefined;
  const automatic = captureProgress?.automatic;
  const recordReason = controller?.recordingUnavailable() ?? "";
  const recordReasonId = `${tabsId}-record-reason`;
  const autoReason = controller?.autoUnavailable() ?? "";
  const autoReasonId = `${tabsId}-auto-reason`;
  const autoPressed = !!automatic && automatic.state !== "off";
  const manualRecording =
    captureProgress?.phase === "recording" && captureProgress.kind === "manual";
  const recordingFramesLeft =
    manualRecording && captureProgress.frames >= captureProgress.capacity * 0.9
      ? captureProgress.capacity - captureProgress.frames
      : undefined;
  const status = captureProgress
    ? {
        ...latest,
        recording: captureProgress.phase === "recording",
        capture: {
          mode: captureProgress.kind,
          state:
            captureProgress.phase === "recording"
              ? ("recording" as const)
              : automatic?.state === "armed" || automatic?.state === "cooldown"
                ? automatic.state
                : ("idle" as const),
        },
      }
    : latest;
  const record = () => {
    if (!controller) return;
    if (controller.recordingUnavailable()) {
      controller.start();
      return;
    }
    const current = controller.getSnapshot();
    if (current.phase === "finalizing") {
      setMode("full");
      setTab("capture");
      return;
    }
    if (current.phase === "unsaved" || (current.phase === "recording" && current.kind === "manual"))
      controller.stopAndSave();
    else controller.start();
    setMode("full");
    setTab("capture");
  };
  const previousMode = useRef(mode);
  useLayoutEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    surface.current
      ?.querySelector<HTMLButtonElement>(`[data-mode-header="${mode}"] button`)
      ?.focus();
  }, [mode]);
  const view = frozen
    ? { ...frozen, ...judgeBudget(frozen.frames, latest.budget, frozen.workMs) }
    : latest;
  const toggleFreeze = () => setFrozen((held) => (held ? null : structuredClone(latest)));
  const resume = () => {
    setFrozen(null);
    surface.current
      ?.querySelector<HTMLButtonElement>(
        mode === "full" ? "[data-panel-transport] button" : `[data-mode-header="${mode}"] button`,
      )
      ?.focus();
  };
  const capture = captureState(status);
  const heldId = frozen?.frames.at(-1)?.id;
  const currentId = latest.frames.at(-1)?.id;
  const since = heldId !== undefined && currentId !== undefined ? currentId - heldId : null;
  const frozenText = heldId === undefined ? "Frozen before first frame" : `Frozen at f${heldId}`;
  const loading = latest.loading?.latest;
  const loadingActive = loading?.status === "loading";
  const panelTabs = [
    "live",
    "loading",
    ...(controller ? ["capture"] : []),
    ...(comparison ? ["compare"] : []),
  ];
  const activeStates = `Live${frozen ? ", frozen" : ""}${capture ? `, ${capture}` : ""}${loadingActive ? ", loading" : ""}${comparing ? ", comparing" : ""}`;
  return (
    <section
      ref={surface}
      data-mode={mode}
      data-frame={view.frames.at(-1)?.id ?? "unknown"}
      data-frozen={frozen ? "" : undefined}
      class={`material-menu relative overflow-hidden font-sans text-jank-text data-frozen:border-jank-frozen ${mode === "mini" ? "w-60" : "w-90"} ${mode === "line" ? "h-7" : ""} ${mode === "full" ? "flex max-h-[calc(100vh-40px)] flex-col" : ""}`}
      aria-label="Live performance panel"
      onKeyDown={(event) => {
        const target = event.target as Element;
        if (
          editingRule ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.repeat ||
          event.isComposing ||
          target.closest("input, select, textarea, [contenteditable]")
        )
          return;
        const key = event.key.toLowerCase();
        if (key !== "m" && key !== "f" && !((key === "r" || key === "a") && controller)) return;
        event.preventDefault();
        event.stopPropagation();
        if (key === "a") controller?.toggleAuto();
        else if (key === "r") record();
        else if (key === "f") toggleFreeze();
        else setMode(mode === "full" ? "mini" : mode === "mini" ? "line" : "full");
      }}
    >
      <div hidden={mode !== "line"}>
        <header data-mode-header="line" class="flex h-6.5 items-center gap-1.5 px-2">
          <StateStrip
            latest={status}
            frozen={!!frozen}
            mode="line"
            recordingFramesLeft={recordingFramesLeft}
            loadingCount={loadingActive ? loading.pending : undefined}
            comparisonProgress={comparisonProgress}
          />
          <CompactMetrics view={view} share={!capture && !frozen && !loadingActive && !comparing} />
          <span class="min-w-0 flex-1" />
          <IconButton
            compact
            label={`Expand to full panel. ${activeStates}`}
            onPress={() => setMode("full")}
          >
            <ModeIcon mode="full" />
          </IconButton>
        </header>
      </div>
      <div hidden={mode === "line"} class={mode === "full" ? "flex min-h-0 flex-1 flex-col" : ""}>
        <header
          data-mode-header={mode}
          class={`flex items-center gap-1 border-b border-jank-divider px-2 ${mode === "full" ? "h-10" : "h-8"}`}
        >
          <StateStrip
            latest={status}
            frozen={!!frozen}
            mode={mode}
            loadingCount={loadingActive ? loading.pending : undefined}
            comparisonProgress={comparisonProgress}
            recordingSeconds={
              manualRecording && captureProgress ? captureProgress.elapsedMs / 1000 : undefined
            }
            recordingFramesLeft={recordingFramesLeft}
            cooldownSeconds={
              automatic?.state === "cooldown" ? automatic.cooldownRemainingMs / 1000 : undefined
            }
          />
          {!editingRule && (
            <>
              <IconButton
                compact={mode === "mini"}
                label={mode === "full" ? "Mini view" : `Expand to full panel. ${activeStates}`}
                onPress={() => setMode(mode === "full" ? "mini" : "full")}
              >
                <ModeIcon mode={mode === "full" ? "mini" : "full"} />
              </IconButton>
              <IconButton
                compact={mode === "mini"}
                label="Line view"
                onPress={() => setMode("line")}
              >
                <ModeIcon mode="line" />
              </IconButton>
            </>
          )}
        </header>
        {editingRule && controller && automatic && (
          <RuleEditor
            controller={controller}
            automatic={automatic}
            budget={latest.budget}
            onClose={() => setEditingRule(false)}
          />
        )}
        <div
          hidden={editingRule}
          class={mode === "full" && !editingRule ? "flex min-h-0 flex-1 flex-col" : ""}
        >
          <div hidden={mode !== "full"}>
            <div
              data-panel-transport
              class="flex items-start gap-1 border-b border-jank-divider px-2 py-2"
            >
              {controller && (
                <Button
                  pressed={manualRecording}
                  onPress={record}
                  unavailable={
                    recordReason
                      ? { reason: recordReason, reasonId: recordReasonId, onExplain: record }
                      : undefined
                  }
                >
                  <span aria-hidden="true" class="text-jank-rec">
                    {manualRecording ? "■" : "●"}
                  </span>
                  {captureProgress?.phase === "finalizing" ? "Finalizing" : "Rec"}
                </Button>
              )}
              {controller && (
                <Button
                  pressed={autoPressed}
                  tone="capture"
                  onPress={controller.toggleAuto}
                  unavailable={
                    autoReason
                      ? {
                          reason: autoReason,
                          reasonId: autoReasonId,
                          onExplain: controller.toggleAuto,
                        }
                      : undefined
                  }
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3 text-jank-capture"
                  >
                    <circle cx="8" cy="8" r="6" />
                    <circle cx="8" cy="8" r="2" />
                  </svg>
                  Auto
                </Button>
              )}
              <Button pressed={!!frozen} onPress={toggleFreeze}>
                <span aria-hidden="true">▣</span>Freeze
              </Button>
              <BudgetControl
                budget={latest.budget}
                onChange={comparing ? undefined : onBudgetChange}
              />
            </div>
            {recordReason && (
              <p
                id={recordReasonId}
                class={
                  // The Compare tab states its own lock beside Run or Stop; say it once.
                  comparing || (comparison && tab === "compare")
                    ? "sr-only"
                    : "px-3 py-1 text-label-12 text-jank-text-secondary"
                }
              >
                {recordReason}
              </p>
            )}
            {autoReason && (
              <span id={autoReasonId} class="sr-only">
                {autoReason}
              </span>
            )}
            <div
              role="tablist"
              aria-label="Panel views"
              class="flex border-b border-jank-divider px-3"
            >
              {panelTabs.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${name}-tab`}
                  aria-controls={`${tabsId}-${name}`}
                  aria-label={
                    name === "compare"
                      ? `Compare${comparing ? `, trial ${comparisonState.trial} of ${comparisonState.bundle.plan.pairs * 2}` : comparisonState?.bundle.status === "complete" ? ", complete" : ""}`
                      : name === "loading"
                        ? loadingActive
                          ? "Loading, in progress"
                          : loading?.status === "failed"
                            ? "Loading, last session failed"
                            : "Loading"
                        : undefined
                  }
                  aria-selected={tab === name}
                  tabIndex={tab === name ? 0 : -1}
                  class={`focus-ring h-9 border-b-2 border-transparent text-label-13 text-jank-text-secondary aria-selected:border-jank-text aria-selected:text-jank-text ${comparison ? "px-2" : "px-3"}`}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      panelTabs[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? panelTabs.length - 1
                            : (index + (event.key === "ArrowRight" ? 1 : panelTabs.length - 1)) %
                              panelTabs.length
                      ];
                    if (!next) return;
                    setTab(next);
                    surface.current
                      ?.querySelector<HTMLButtonElement>(`#${tabsId}-${next}-tab`)
                      ?.focus();
                  }}
                >
                  {name === "live" ? (
                    "Live"
                  ) : name === "loading" ? (
                    <>
                      Loading
                      {(loadingActive || loading?.status === "failed") && (
                        <span
                          aria-hidden="true"
                          class={`ml-1 ${loadingActive ? "text-jank-text" : "text-jank-error"}`}
                        >
                          {loadingActive ? "◐" : "!"}
                        </span>
                      )}
                    </>
                  ) : name === "compare" ? (
                    <>
                      Compare
                      {comparisonProgress ? (
                        <span class="ml-1 text-label-12">{comparisonProgress}</span>
                      ) : comparisonState?.bundle.status === "complete" ? (
                        " ✓"
                      ) : (
                        ""
                      )}
                    </>
                  ) : (
                    `Capture (${captureProgress?.saved.length ?? 0})`
                  )}
                </button>
              ))}
            </div>
          </div>
          {comparisonInterruption ? (
            <div data-panel-notice class="p-2">
              <Notice
                tone="error"
                role={comparisonInterruption === "interrupted" ? "status" : "alert"}
                onDismiss={() => setDismissedComparison(comparisonState?.bundle)}
              >
                {comparisonError}
              </Notice>
            </div>
          ) : error ? (
            <div data-panel-notice class="p-2">
              <Notice tone="error">{error}</Notice>
            </div>
          ) : captureProgress?.blocked ? (
            <div data-panel-notice class="p-2">
              <Notice
                tone="warning"
                onDismiss={() => controller?.dismissBlocked()}
                action={
                  comparing && tab !== "compare" ? (
                    <Button
                      onPress={() => {
                        comparison?.stop();
                        controller?.dismissBlocked();
                      }}
                    >
                      Stop comparison
                    </Button>
                  ) : tab !== "capture" && manualRecording ? (
                    <Button onPress={record}>Stop and save</Button>
                  ) : undefined
                }
              >
                {captureProgress.blocked} {manualRecording && "The recording continues."}
              </Notice>
            </div>
          ) : savedCapture && savedId !== dismissedCapture ? (
            <div
              data-panel-notice
              role="status"
              aria-label={`Capture C${savedId} saved`}
              class="flex h-10 items-center gap-2 border-b border-green-400 bg-green-100 px-2 text-copy-13 text-green-1000"
            >
              <CaptureSummary capture={savedCapture} notice />
              <CaptureActions
                capture={savedCapture}
                onOpen={openCapture}
                onExport={exportCapture}
                primary
              />
              <IconButton
                compact
                label="Dismiss saved capture notice"
                onPress={() => {
                  setDismissedCapture(savedId);
                  surface.current
                    ?.querySelector<HTMLButtonElement>(
                      mode === "full"
                        ? "[data-panel-transport] button"
                        : `[data-mode-header="${mode}"] button`,
                    )
                    ?.focus();
                }}
              >
                <DismissIcon />
              </IconButton>
            </div>
          ) : frozen ? (
            <div
              data-panel-notice
              role="status"
              aria-label="Display frozen; collection continues"
              class="flex h-10 items-center justify-between gap-2 border-b border-teal-400 bg-teal-100 px-2 text-label-12 text-teal-1000"
            >
              <span class="min-w-0 truncate" title={frozenText}>
                {mode === "mini" && heldId !== undefined ? `f${heldId}` : frozenText}
                <span aria-hidden="true">
                  {since === null ? "" : since < 0 ? " · source restarted" : ` · +${since} since`}
                </span>
              </span>
              <Button onPress={resume}>Resume</Button>
            </div>
          ) : message && !message.startsWith("Capture C") && message !== dismissedMessage ? (
            <div data-panel-notice class="p-2">
              <Notice onDismiss={() => setDismissedMessage(message)}>{message}</Notice>
            </div>
          ) : null}
          <section
            hidden={mode !== "full" || tab !== "live"}
            data-mode-body="full"
            id={`${tabsId}-live`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-live-tab`}
            class="h-144 min-h-0"
          >
            <div class="flex h-full flex-col">
              <FullMetrics view={view} />
              <LiveDetails
                view={view}
                frozen={!!frozen}
                recordingAfterFrame={recordingAfterFrame}
                automatic={automatic}
              />
            </div>
          </section>
          <div
            hidden={mode !== "full" || tab !== "loading"}
            id={`${tabsId}-loading`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-loading-tab`}
            class="h-144 min-h-0"
          >
            <LoadingTab model={view.loading} frozen={!!frozen} />
          </div>
          {captureConnection && captureProgress && (
            <div
              hidden={mode !== "full" || tab !== "capture"}
              id={`${tabsId}-capture`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-capture-tab`}
              class="h-144 min-h-0"
            >
              <CaptureView
                connection={captureConnection}
                state={captureProgress}
                budget={latest.budget}
                onOpen={openCapture}
                onExport={exportCapture}
                onEditRule={() => setEditingRule(true)}
                instrumentation={instrumentation}
                onInstrumentationError={setActionError}
              />
            </div>
          )}
          {comparison && comparisonState && (
            <div
              hidden={mode !== "full" || tab !== "compare"}
              id={`${tabsId}-compare`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-compare-tab`}
              class="h-144 min-h-0"
            >
              <CompareTab
                controller={comparison}
                state={comparisonState}
                budget={latest.budget}
                loading={loadingActive}
              />
            </div>
          )}
          <div hidden={mode !== "full"}>
            <OverheadFooter view={view} />
          </div>
          {mode === "mini" && (
            <div data-mode-body="mini">
              <MiniContent
                view={view}
                frozen={!!frozen}
                recordingAfterFrame={recordingAfterFrame}
                automatic={automatic}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
