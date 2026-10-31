import { summarizeFrames } from "../analysis/statistics.ts";
import { drawRecordingChart } from "../charts/recording-chart.ts";
import { readComparison } from "../comparison/codec.ts";
import { createDownload } from "../panel/download.ts";
import { readRecording } from "../recordings/codec.ts";
import { recordingLimits } from "../recordings/limits.ts";
import { renderComparison, renderSettings } from "./comparison-view.ts";
import { initialViewerState, parseViewerDocument } from "./document.ts";
import { element, write } from "./dom.ts";
import { renderFrame, renderRecordingEvidence } from "./frame-view.ts";
import { viewerMarkup } from "./markup.ts";
import type { CreateViewer, ViewerDocument, ViewerImportResult, ViewerState } from "./viewer.ts";

export const createViewer: CreateViewer = ({ container }) => {
  const document = container.ownerDocument;
  const root = document.createElement("section");
  root.className = "jl jank-viewer";
  root.setAttribute("aria-label", "Jank recording viewer");
  root.innerHTML = viewerMarkup();
  container.append(root);
  const download = createDownload(document);
  const canvas = element<HTMLCanvasElement>(root, "[data-viewer-chart]");
  let state: ViewerState = { status: "empty" };
  let gpuIndex = 0;
  let disposed = false;
  let generation = 0;

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
    state = initialViewerState(input);
    const { comparison, recording } = state;
    element<HTMLElement>(root, '[role="alert"]').hidden = true;
    element<HTMLElement>(root, "[data-viewer-comparison]").hidden = !comparison;
    if (comparison) {
      renderComparison(root, comparison);
    }
    write(
      root,
      "status",
      comparison
        ? `Opened ${comparison.trials.length} comparison trials. Results recalculated from validated recordings. Files stay on this device.`
        : `Opened ${recording?.frames.length ?? 0} sealed frames. Files stay on this device.`,
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
    element<HTMLElement>(root, "[data-viewer-recording]").hidden = !recording;
    element<HTMLButtonElement>(root, '[data-viewer-action="export"]').disabled = !recording;
    if (comparison) {
      element<HTMLSelectElement>(root, "[data-viewer-trial]").value = String(
        selectedTrialIndex ?? "",
      );
      renderSettings(root, comparison, selectedTrialIndex ?? 0);
    }
    if (!recording) {
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
    if (disposed || state.status !== "loaded" || !state.recording) {
      return;
    }
    drawRecordingChart(canvas, {
      frames: state.recording.frames.slice(
        state.firstVisibleIndex,
        state.firstVisibleIndex + state.visibleFrameCount,
      ),
      budgetMs: 1000 / state.recording.targetFps,
      selectedFrameId: state.selectedFrameId,
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
      input.value = String(value);
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
    renderFrame(root, state.recording, state.selectedFrameId, gpuIndex);
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
      selectedFrameId: trial.recording.frames[0]?.id ?? null,
      firstVisibleIndex: 0,
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
      firstVisibleIndex: inRange
        ? state.firstVisibleIndex
        : Math.floor(index / state.visibleFrameCount) * state.visibleFrameCount,
    };
    gpuIndex = 0;
    renderNavigation();
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
        importJson(json);
      }
    } catch (cause) {
      if (epoch === generation) {
        error(cause);
      }
    }
  }
  function change(target: Element): void {
    if (target instanceof HTMLInputElement && target.matches("[data-viewer-file]")) {
      const file = target.files?.[0];
      if (file) {
        void readFile(file);
      }
      target.value = "";
      return;
    }
    if (state.status !== "loaded") {
      return;
    }
    if (target instanceof HTMLSelectElement && target.matches("[data-viewer-trial]")) {
      selectTrial(Number(target.value));
    } else {
      changeFrameControl(target);
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
      renderFrame(root, state.recording, state.selectedFrameId, gpuIndex);
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
  function click(event: Event): void {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) {
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
  function onEvent(event: Event): void {
    if (disposed || !(event.target instanceof Element)) {
      return;
    }
    try {
      if (event.type === "change") {
        change(event.target);
      }
      if (event.type === "click") {
        click(event);
      }
      if (event.type === "keydown") {
        keydown(event);
      }
    } catch (cause) {
      error(cause);
    }
  }
  function selectChartFrame(event: MouseEvent): void {
    if (state.status !== "loaded" || !state.recording) {
      return;
    }
    const count = Math.min(
      state.visibleFrameCount,
      state.recording.frames.length - state.firstVisibleIndex,
    );
    const bounds = canvas.getBoundingClientRect();
    const index =
      state.firstVisibleIndex +
      Math.min(count - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * count));
    const frame = state.recording.frames[index];
    if (frame) {
      selectFrame(frame.id);
    }
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
  for (const type of ["click", "change", "keydown"]) {
    root.addEventListener(type, onEvent);
  }
  root.addEventListener("dragover", drag);
  root.addEventListener("drop", drop);
  const resize = new ResizeObserver(draw);
  resize.observe(canvas);
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
    setRange,
    snapshot: () => structuredClone(state),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      generation += 1;
      for (const type of ["click", "change", "keydown"]) {
        root.removeEventListener(type, onEvent);
      }
      root.removeEventListener("dragover", drag);
      root.removeEventListener("drop", drop);
      resize.disconnect();
      download.dispose();
      state = { status: "empty" };
      root.remove();
    },
  };
};
