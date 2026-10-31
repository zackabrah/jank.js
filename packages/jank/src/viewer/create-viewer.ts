import { type CaptureMark, findCaptureMarks } from "../analysis/capture-marks.ts";
import { frameAtElapsed, type WorkIdentity, workCatalog } from "../analysis/frame-comparison.ts";
import { summarizeFrames } from "../analysis/statistics.ts";
import { fitTimelineWindow } from "../analysis/timeline.ts";
import { receiveViewerHandoff } from "../browser/viewer-handoff.ts";
import { drawRecordingChart } from "../charts/recording-chart.ts";
import { readComparison } from "../comparison/codec.ts";
import { createDownload } from "../panel/download.ts";
import { readRecording, serializeRecording } from "../recordings/codec.ts";
import { extractCapture } from "../recordings/excerpt.ts";
import { recordingLimits } from "../recordings/limits.ts";
import { captureAtSelection, renderCaptures, updateCaptureSelection } from "./capture-view.ts";
import { renderComparison, renderSettings } from "./comparison-view.ts";
import { initialViewerState, parseViewerDocument } from "./document.ts";
import { element, write } from "./dom.ts";
import { renderFrame, renderNoRecording, renderRecordingEvidence } from "./frame-view.ts";
import { copyFrameEvidence, renderInspectorActions } from "./inspector-actions.ts";
import { viewerMarkup } from "./markup.ts";
import { drawPairedCharts, pairedWindow, renderPaired, selectedPair } from "./paired-view.ts";
import { createSessionNavigation } from "./session-navigation.ts";
import { drawSession, sessionDuration } from "./session-view.ts";
import { createTimelineNavigation, recordingWindow } from "./timeline-navigation.ts";
import type { CreateViewer, ViewerDocument, ViewerImportResult, ViewerState } from "./viewer.ts";

export const createViewer: CreateViewer = ({ container, receiveFromOpener = false }) => {
  const document = container.ownerDocument;
  const root = document.createElement("section");
  root.className = "jl jank-viewer";
  root.setAttribute("aria-label", "Jank recording viewer");
  root.innerHTML = viewerMarkup();
  container.append(root);
  const download = createDownload(document);
  const canvas = element<HTMLCanvasElement>(root, "[data-viewer-chart]");
  let state: ViewerState = { status: "empty" };
  const session = createSessionNavigation(root, {
    state: () => state,
    pan: (fromMs) => {
      if (state.status !== "loaded" || !state.recording) {
        return;
      }
      if (state.comparison) {
        state = { ...state, comparisonWindowStartMs: fromMs };
        renderNavigation();
      } else {
        const frames = state.recording.frames;
        const origin = frames[0]?.startedAtMs ?? 0;
        const index = frames.findIndex((frame) => frame.startedAtMs - origin >= fromMs);
        if (index >= 0) {
          setRange(
            Math.min(index, Math.max(0, frames.length - state.visibleFrameCount)),
            state.visibleFrameCount,
          );
        }
      }
    },
  });
  let gpuIndex = 0;
  let captures: readonly CaptureMark[] = [];
  let catalog: readonly WorkIdentity[] = [];
  let recordingCatalog: readonly WorkIdentity[] = [];
  const timeline = createTimelineNavigation(root, {
    state: () => state,
    select: (elapsedMs) => selectTimelineTime(elapsedMs),
    range: (firstIndex, count) => setRange(firstIndex, count),
    window: (fromMs, durationMs) => {
      if (state.status !== "loaded") {
        return;
      }
      state = { ...state, comparisonWindowStartMs: fromMs, comparisonWindowMs: durationMs };
      renderNavigation();
    },
  });
  let disposed = false;
  let generation = 0;
  let copyRequest = 0;

  function error(cause: unknown): void {
    if (disposed) {
      return;
    }
    const alert = element<HTMLElement>(root, '[role="alert"]');
    alert.textContent =
      cause instanceof Error ? cause.message : "Unable to read the selected file.";
    alert.hidden = false;
  }
  function setDocument(input: ViewerDocument): void {
    if (disposed) {
      return;
    }
    generation += 1;
    session.clear();
    state = initialViewerState(input);
    timeline.clear();
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[data-gpu-group]")) {
      details.open = false;
    }
    const { comparison, recording } = state;
    element<HTMLElement>(root, '[role="alert"]').hidden = true;
    element<HTMLElement>(root, "[data-viewer-comparison]").hidden = !comparison;
    element<HTMLElement>(root, "[data-viewer-empty]").hidden = true;
    for (const node of root.querySelectorAll<HTMLElement>("[data-comparison-only]")) {
      node.hidden = !comparison;
    }
    for (const node of root.querySelectorAll<HTMLElement>("[data-single-only]")) {
      node.hidden = Boolean(comparison);
    }
    write(root, "file-name", comparison ? "A/B comparison" : "Recording");
    if (comparison) {
      renderComparison(root, comparison);
    }
    write(
      root,
      "status",
      comparison
        ? `Opened ${comparison.trials.length} comparison trials · results recalculated`
        : `Opened ${recording?.frames.length ?? 0} sealed frames`,
    );
    renderSelection();
  }
  function importJson(json: string): ViewerImportResult {
    generation += 1;
    if (disposed) {
      return {
        ok: false,
        problem: { code: "invalid-data", path: "$", message: "Viewer disposed" },
      };
    }
    const parsed = parseViewerDocument(json);
    if (!parsed.ok) {
      error(new Error(`${parsed.problem.path}: ${parsed.problem.message}`));
      return parsed;
    }
    setDocument(parsed.value);
    return { ok: true, kind: parsed.value.kind };
  }
  function renderSelection(): void {
    if (state.status !== "loaded") {
      return;
    }
    const { recording, comparison, selectedTrialIndex } = state;
    gpuIndex = 0;
    recordingCatalog = workCatalog(recording, null);
    captures = findCaptureMarks(recording);
    renderCaptures(root, state, captures);
    element<HTMLElement>(root, "[data-viewer-recording]").hidden = !recording && !comparison;
    element<HTMLButtonElement>(root, '[data-viewer-action="export"]').disabled = !recording;
    if (comparison) {
      element<HTMLSelectElement>(root, "[data-viewer-trial]").value = String(
        selectedTrialIndex ?? "",
      );
      renderSettings(root, comparison, selectedTrialIndex ?? 0);
      const pair = selectedPair(state);
      catalog = workCatalog(pair.a?.recording ?? null, pair.b?.recording ?? null);
      renderPaired(root, state, catalog);
    }
    timeline.render(catalog, recordingCatalog);
    if (!recording) {
      renderNoRecording(root);
      renderInspectorActions(root, state);
      draw();
      return;
    }
    const trial = comparison?.trials[selectedTrialIndex ?? 0];
    write(
      root,
      "recording-title",
      trial ? `PAIR ${trial.pair} / ${trial.variant} · ${trial.context.label}` : "RECORDING",
    );
    renderRecordingEvidence(root, recording, trial);
    renderNavigation();
  }
  function draw(): void {
    if (disposed || state.status !== "loaded") {
      return;
    }
    drawSession(root, state);
    if (state.comparison) {
      drawPairedCharts(root, state);
      return;
    }
    if (!state.recording) {
      return;
    }
    drawRecordingChart(canvas, {
      frames: state.recording.frames.slice(
        state.firstVisibleIndex,
        state.firstVisibleIndex + state.visibleFrameCount,
      ),
      budgetMs: 1000 / state.recording.targetFps,
      selectedFrameId: state.selectedFrameId,
      timeline: {
        ...recordingWindow(state),
        originMs: state.recording.frames[0]?.startedAtMs ?? 0,
        selectedMs: state.comparisonElapsedMs,
      },
    });
  }
  function renderNavigation(): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    const frames = state.recording.frames;
    const selectedFrameId = state.selectedFrameId;
    const selected = frames.findIndex((frame) => frame.id === selectedFrameId);
    for (const [name, value] of [
      ["frame-position", selected + 1],
      ["range-start", state.firstVisibleIndex + 1],
    ] as const) {
      const input = element<HTMLInputElement>(root, `[data-viewer-${name}]`);
      input.value = name === "frame-position" && selected < 0 ? "" : String(value);
      input.max = String(frames.length);
      input.disabled = frames.length === 0;
    }
    element<HTMLSelectElement>(root, "[data-viewer-range-count]").value = String(
      state.visibleFrameCount,
    );
    for (const [name, disabled] of [
      ["previous", selected <= 0],
      ["next", selected >= frames.length - 1],
      ["worst", frames.length === 0],
      ["range-previous", state.firstVisibleIndex === 0],
      ["range-next", state.firstVisibleIndex + state.visibleFrameCount >= frames.length],
    ] as const) {
      element<HTMLButtonElement>(root, `[data-viewer-action="${name}"]`).disabled = disabled;
    }
    write(
      root,
      "range-note",
      frames.length
        ? `Positions ${state.firstVisibleIndex + 1}–${Math.min(frames.length, state.firstVisibleIndex + state.visibleFrameCount)} of ${frames.length}. Click a bar or use frame controls. Orange bars exceed the exact budget; A/B frame-pacing statistics allow 1 ms or 5% tolerance.`
        : "No frames to display.",
    );
    updateCaptureSelection(root, state, captures);
    renderInspectorActions(root, state);
    renderFrame(root, state.recording, state.selectedFrameId, {
      gpuIndex,
      compact: !state.comparison,
    });
    if (state.comparison) {
      renderPaired(root, state, catalog);
    }
    timeline.render(catalog, recordingCatalog);
    draw();
  }
  function selectTrial(index: number): void {
    if (disposed) {
      return;
    }
    const trial = state.status === "loaded" ? state.comparison?.trials[index] : null;
    if (state.status !== "loaded" || !Number.isInteger(index) || !trial) {
      throw new RangeError("Choose an existing comparison trial");
    }
    state = {
      ...state,
      recording: trial.recording,
      selectedTrialIndex: index,
      selectedFrameId: frameAtElapsed(trial.recording, state.comparisonElapsedMs)?.id ?? null,
      firstVisibleIndex: 0,
    };
    const selectedId = state.selectedFrameId;
    const position = trial.recording.frames.findIndex((frame) => frame.id === selectedId);
    state = {
      ...state,
      firstVisibleIndex:
        Math.floor(Math.max(0, position) / state.visibleFrameCount) * state.visibleFrameCount,
    };
    renderSelection();
  }
  function selectFrame(frameId: number): void {
    if (disposed || state.status !== "loaded" || !state.recording) {
      return;
    }
    const index = state.recording.frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) {
      throw new RangeError("Frame is not in the selected recording");
    }
    const inRange =
      index >= state.firstVisibleIndex && index < state.firstVisibleIndex + state.visibleFrameCount;
    state = {
      ...state,
      selectedFrameId: frameId,
      comparisonElapsedMs:
        (state.recording.frames[index]?.startedAtMs ?? 0) -
        (state.recording.frames[0]?.startedAtMs ?? 0),
      firstVisibleIndex: inRange
        ? state.firstVisibleIndex
        : Math.floor(index / state.visibleFrameCount) * state.visibleFrameCount,
    };
    followComparisonSelection();
    gpuIndex = 0;
    renderNavigation();
  }
  function selectComparisonTime(elapsedMs: number): void {
    if (disposed || state.status !== "loaded" || !state.comparison) {
      return;
    }
    if (
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0 ||
      elapsedMs > state.comparison.options.measureMs
    ) {
      throw new RangeError("Choose an elapsed time inside the measurement window");
    }
    applyElapsedSelection(elapsedMs);
  }
  function applyElapsedSelection(elapsedMs: number): void {
    if (state.status !== "loaded") {
      return;
    }
    const frame = frameAtElapsed(state.recording, elapsedMs);
    const index =
      state.recording?.frames.findIndex((candidate) => candidate.id === frame?.id) ?? -1;
    const inRange =
      index >= state.firstVisibleIndex && index < state.firstVisibleIndex + state.visibleFrameCount;
    state = {
      ...state,
      comparisonElapsedMs: elapsedMs,
      selectedFrameId: frame?.id ?? null,
      firstVisibleIndex:
        index < 0 || inRange
          ? state.firstVisibleIndex
          : Math.floor(index / state.visibleFrameCount) * state.visibleFrameCount,
    };
    followComparisonSelection();
    gpuIndex = 0;
    renderNavigation();
  }
  function followComparisonSelection(): void {
    if (state.status !== "loaded" || !state.comparison) {
      return;
    }
    const window = pairedWindow(state);
    const time = state.comparisonElapsedMs;
    if (
      time < window.fromMs ||
      (time >= window.toMs && time < state.comparison.options.measureMs)
    ) {
      const next = fitTimelineWindow(
        Math.floor(time / state.comparisonWindowMs) * state.comparisonWindowMs,
        state.comparisonWindowMs,
        state.comparison.options.measureMs,
      );
      state = { ...state, comparisonWindowStartMs: next.fromMs };
    }
  }
  function selectTimelineTime(elapsedMs: number): void {
    if (state.status !== "loaded") {
      return;
    }
    if (state.comparison) {
      selectComparisonTime(elapsedMs);
      return;
    }
    applyElapsedSelection(elapsedMs);
  }

  function setRange(firstIndex: number, frameCount: number): void {
    if (disposed || state.status !== "loaded" || !state.recording) {
      return;
    }
    if (
      !Number.isInteger(firstIndex) ||
      firstIndex < 0 ||
      firstIndex >= state.recording.frames.length ||
      ![50, 100, 200].includes(frameCount)
    ) {
      throw new RangeError("Choose an existing range start and 50, 100 or 200 frames");
    }
    state = { ...state, firstVisibleIndex: firstIndex, visibleFrameCount: frameCount };
    renderNavigation();
  }
  function navigate(action: string): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    const { frames } = state.recording;
    const selectedFrameId = state.selectedFrameId;
    switch (action) {
      case "export":
        download.save(state.recording);
        return;
      case "range-previous":
        setRange(
          Math.max(0, state.firstVisibleIndex - state.visibleFrameCount),
          state.visibleFrameCount,
        );
        return;
      case "range-next":
        setRange(
          Math.min(frames.length - 1, state.firstVisibleIndex + state.visibleFrameCount),
          state.visibleFrameCount,
        );
        return;
      case "worst": {
        const statistics = summarizeFrames(frames, state.recording.targetFps);
        if (statistics) {
          selectFrame(statistics.worstFrameId);
        }
        return;
      }
      default: {
        const index = frames.findIndex((frame) => frame.id === selectedFrameId);
        const frame = frames[index + (action === "next" ? 1 : -1)];
        if (frame) {
          selectFrame(frame.id);
        }
      }
    }
  }
  async function readFile(file: File): Promise<void> {
    const epoch = ++generation;
    try {
      if (file.size > recordingLimits.fileBytes) {
        throw new Error("File exceeds 32 MiB.");
      }
      const json = await file.text();
      if (!disposed && epoch === generation) {
        const result = importJson(json);
        if (result.ok) {
          write(root, "file-name", file.name);
        }
      }
    } catch (cause) {
      if (epoch === generation) {
        error(cause);
      }
    }
  }
  function openSelectedFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (file) {
      void readFile(file);
    }
    input.value = "";
  }
  function change(target: Element): void {
    if (target instanceof HTMLInputElement && target.matches("[data-viewer-file]")) {
      openSelectedFile(target);
      return;
    }
    if (state.status !== "loaded") {
      return;
    }
    if (target.matches("[data-series-visibility]")) {
      draw();
      return;
    }
    if (target.matches("[data-paired-time], [data-paired-window]")) {
      changeComparisonControl(target);
      return;
    }
    changeSelection(target);
  }
  function changeSelection(target: Element): void {
    if (target instanceof HTMLSelectElement && target.matches("[data-episode-trigger]")) {
      if (target.value !== "") {
        selectFrame(Number(target.value));
      }
      return;
    }
    if (target instanceof HTMLSelectElement && target.matches("[data-viewer-trial]")) {
      selectTrial(Number(target.value));
    } else {
      changeFrameControl(target);
    }
  }
  function changeComparisonControl(target: Element): void {
    if (state.status !== "loaded") {
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-paired-time]")) {
      selectComparisonTime(target.valueAsNumber);
      return;
    }
    if (target instanceof HTMLSelectElement && target.matches("[data-paired-window]")) {
      const durationMs = Number(target.value);
      const window = fitTimelineWindow(
        Math.floor(state.comparisonElapsedMs / durationMs) * durationMs,
        durationMs,
        state.comparison?.options.measureMs ?? 1000,
      );
      state = { ...state, comparisonWindowMs: durationMs, comparisonWindowStartMs: window.fromMs };
      renderNavigation();
      return;
    }
  }
  function refreshCompactComparison(): void {
    if (state.status === "loaded" && state.comparison) {
      renderPaired(root, state, catalog);
    }
  }
  function changeFrameControl(target: Element): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    if (target instanceof HTMLInputElement && target.matches("[data-viewer-frame-position]")) {
      const frame = state.recording.frames[target.valueAsNumber - 1];
      if (!frame) {
        throw new RangeError("Choose an existing frame position");
      }
      selectFrame(frame.id);
    } else if (target.matches("[data-viewer-gpu-observation]")) {
      gpuIndex = Number(element<HTMLSelectElement>(root, "[data-viewer-gpu-observation]").value);
      renderFrame(root, state.recording, state.selectedFrameId, {
        gpuIndex,
        compact: !state.comparison,
      });
      refreshCompactComparison();
      element<HTMLSelectElement>(root, "[data-viewer-gpu-observation]").focus({
        preventScroll: true,
      });
    } else if (target.matches("[data-viewer-range-start], [data-viewer-range-count]")) {
      setRange(
        element<HTMLInputElement>(root, "[data-viewer-range-start]").valueAsNumber - 1,
        Number(element<HTMLSelectElement>(root, "[data-viewer-range-count]").value),
      );
    }
  }
  function stepCapture(direction: 1 | -1): void {
    if (state.status !== "loaded" || captures.length === 0) {
      return;
    }
    const selected = captureAtSelection(state, captures);
    const initial = direction === 1 ? -1 : 0;
    const index = selected ? captures.indexOf(selected) : initial;
    const next = captures[(index + direction + captures.length) % captures.length];
    if (next) {
      selectFrame(next.frameId);
    }
  }
  function captureAction(button: HTMLButtonElement): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    const mark =
      captures.find((mark) => mark.frameId === Number(button.dataset.captureFrame)) ??
      captureAtSelection(state, captures);
    switch (button.dataset.captureAction) {
      case "export":
        if (mark) {
          download.saveJson(
            serializeRecording(extractCapture(state.recording, mark.frameId)),
            `jank-capture-${mark.rank}-frame-${mark.frameId}.json`,
          );
        }
        return;
      case "open":
        if (mark) {
          selectFrame(mark.frameId);
        }
        return;
      case "previous":
        stepCapture(-1);
        return;
      case "next":
        stepCapture(1);
        return;
    }
  }
  function inspectorClick(target: Element): boolean {
    if (target.closest("[data-copy-frame]")) {
      const capturedState = state;
      const request = ++copyRequest;
      void copyFrameEvidence(
        root,
        capturedState,
        () => !disposed && state === capturedState && request === copyRequest,
      );
      return true;
    }
    const nearby = target.closest<HTMLButtonElement>("[data-nearby-event]");
    if (nearby && state.status === "loaded" && state.recording) {
      const index = Number(nearby.dataset.nearbyEvent);
      const observation = state.recording.events[index];
      if (observation) {
        selectTimelineTime(observation.atMs - (state.recording.frames[0]?.startedAtMs ?? 0));
        root
          .querySelector<HTMLButtonElement>(`[data-nearby-event="${index}"]`)
          ?.focus({ preventScroll: true });
      }
      return true;
    }
    return false;
  }
  function click(event: Event): void {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) {
      return;
    }
    if (inspectorClick(event.target)) {
      return;
    }
    const captureButton = event.target.closest<HTMLButtonElement>("[data-capture-action]");
    if (captureButton) {
      captureAction(captureButton);
      return;
    }
    if (event.target.matches("[data-session-chart]") && state.status === "loaded") {
      const bounds = event.target.getBoundingClientRect();
      selectTimelineTime(
        Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) *
          sessionDuration(state),
      );
      return;
    }
    if (event.target === canvas) {
      selectChartFrame(event);
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button[data-viewer-action]");
    if (button) {
      navigate(button.dataset.viewerAction ?? "");
    }
  }
  function keydown(event: Event): void {
    if (
      event instanceof KeyboardEvent &&
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement
    ) {
      event.preventDefault();
      change(event.target);
    }
  }
  function captureKey(event: Event): boolean {
    if (
      !(event instanceof KeyboardEvent) ||
      !(event.target instanceof Element) ||
      !["[", "]"].includes(event.key) ||
      !event.target.matches(
        "[data-lane-surface], [data-session-chart], [data-viewer-chart], [data-paired-chart]",
      )
    ) {
      return false;
    }
    event.preventDefault();
    const label = event.target.getAttribute("aria-label");
    stepCapture(event.key === "]" ? 1 : -1);
    for (const node of root.querySelectorAll<SVGSVGElement>("[data-lane-surface]")) {
      if (node.getAttribute("aria-label") === label) {
        node.focus({ preventScroll: true });
      }
    }
    return true;
  }
  function onEvent(event: Event): void {
    if (disposed || !(event.target instanceof Element)) {
      return;
    }
    try {
      if (session.handle(event) || captureKey(event) || timeline.handle(event)) {
        return;
      }
      switch (event.type) {
        case "change":
          change(event.target);
          break;
        case "input":
          if (event.target.matches("input[type=range]")) {
            change(event.target);
          }
          break;
        case "click":
          click(event);
          break;
        case "keydown":
          keydown(event);
          break;
      }
    } catch (cause) {
      error(cause);
    }
  }
  function selectChartFrame(event: MouseEvent): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const window = recordingWindow(state);
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    selectTimelineTime(window.fromMs + fraction * (window.toMs - window.fromMs));
  }
  const drag = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file) {
      void readFile(file);
    }
  };
  for (const type of [
    "click",
    "change",
    "input",
    "keydown",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "pointermove",
    "pointerout",
    "wheel",
  ]) {
    root.addEventListener(type, onEvent);
  }
  const stopHandoff = receiveFromOpener
    ? receiveViewerHandoff({
        window: document.defaultView,
        importJson,
        unchanged: () => !disposed && generation === 0,
      })
    : () => {};
  root.addEventListener("dragover", drag);
  root.addEventListener("drop", drop);
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);
  for (const chart of root.querySelectorAll("[data-paired-chart], [data-session-chart]")) {
    resize.observe(chart);
  }
  return {
    load: (recording) => {
      generation += 1;
      if (!disposed) {
        setDocument({ kind: "recording", recording: readRecording(recording) });
      }
    },
    loadComparison: (comparison) => {
      generation += 1;
      if (!disposed) {
        setDocument({ kind: "comparison", comparison: readComparison(comparison) });
      }
    },
    import: importJson,
    selectFrame,
    selectTrial,
    selectComparisonTime,
    setRange,
    snapshot: () => structuredClone(state),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      stopHandoff();
      session.clear();
      generation += 1;
      for (const type of [
        "click",
        "change",
        "input",
        "keydown",
        "pointerdown",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
        "pointermove",
        "pointerout",
        "wheel",
      ]) {
        root.removeEventListener(type, onEvent);
      }
      root.removeEventListener("dragover", drag);
      root.removeEventListener("drop", drop);
      resize.disconnect();
      download.dispose();
      captures = [];
      catalog = [];
      recordingCatalog = [];
      timeline.clear();
      state = { status: "empty" };
      root.remove();
    },
  };
};
