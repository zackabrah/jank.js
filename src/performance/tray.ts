import {
  automaticCapture,
  completeCoverage,
  maxAfterFrames,
  maxBeforeFrames,
  maxTargetFps,
  msPerSecond,
  recordingFrameCapacity,
  serializeRecording,
} from "../core/recording.ts";

import {
  iconLabel,
  intervalUnion,
  nearbyEventLabels,
  scopesBySystem,
  sortedP95,
} from "../core/inspection.ts";

import { download, findIn } from "./ui/dom.ts";

import { panelMarkup } from "./ui/markup.ts";

import {
  drawFrameGraph,
  drawThumbnail,
  graphTheme,
  prepareCanvas,
  type GraphTheme,
} from "./ui/graph.ts";

import {
  axisStep,
  budgetLimit,
  count,
  counter,
  counterSources,
  fixed,
  observedTick,
  timerHonesty,
  words,
} from "./ui/format.ts";

import {
  defaultAfterFrames,
  defaultBeforeFrames,
  defaultCooldownMs,
  type Diagnostics,
  type DiagnosticFrame,
  type DiagnosticSnapshot,
} from "../core/diagnostics.ts";

import type {
  AutoCaptureOptions,
  DiagnosticEvent,
  PerformanceRecording,
} from "../core/recording-types.ts";

import type { PreparationSnapshot } from "../core/preparation.ts";

import type { GpuProfile } from "../types/gpu-profile-types.ts";

import type { CullingDiagnostics } from "../types/culling-types.ts";

import type {
  TemporalDebugView,
  TemporalDiagnostics,
} from "../types/motion-types.ts";

const percent = 100;

const bytesPerMegabyte = 1e6;

/** Graph bars are drawn at a 3 px pitch. */
const graphPitch = 3;

const gpuStatus = {
  unsupported: "unsupported",
  disabled: "disabled",
  pending: "pending",
  ready: "ready",
  error: "error",
} as const;

/** Optional renderer timing source; the host retains renderer and frame-loop ownership. */
export interface PerformanceGpuSource {
  read(): GpuProfile | undefined;

  setEnabled(enabled: boolean): void;
  /** Names the source in the panel, for example `three.js webgpu`. Defaults to `renderer`. */
  label?: string;
}

/** Optional visibility source; settings remain owned by the host renderer. */
export interface PerformanceCullingSource {
  read(): CullingDiagnostics | undefined;

  setEnabled(enabled: boolean): void;

  setDebugBounds(enabled: boolean): void;

  setInstancesEnabled?(enabled: boolean): void;
}

/** Optional temporal diagnostics; the existing renderer remains the frame owner. */
export interface PerformanceTemporalSource {
  read(): TemporalDiagnostics | undefined;

  setEnabled(enabled: boolean): void;

  setDebugView(view: TemporalDebugView): void;
}

/** Loading measurements are host-owned and use elapsed CPU/promise time, not GPU timestamps. */
export interface PerformancePreparationSource {
  read(): PreparationSnapshot | null;

  history(): readonly PreparationSnapshot[];
}

/** A detached copy, so a frozen or exported profile can't change under the panel. */
export function copyTemporalDiagnostics(
  profile: TemporalDiagnostics,
): TemporalDiagnostics {
  return { ...profile };
}

/** Status line for whether object motion feeds temporal reconstruction. */
export function temporalHistoryStatus(
  profile: TemporalDiagnostics | undefined,
): string {
  if (!profile) return "waiting for the renderer";

  return profile.objectMotion
    ? "on · opted-in rigid objects contribute their previous transforms"
    : "off · reconstruction uses camera motion only";
}

/** A deep copy, so a frozen or exported view can't change under the panel. */
export function copyCullingDiagnostics(
  profile: CullingDiagnostics,
): CullingDiagnostics {
  return {
    ...profile,
    ...(profile.distance ? { distance: { ...profile.distance } } : {}),
    main: { ...profile.main },
    shadow: { ...profile.shadow },
    reflection: { ...profile.reflection },
    bounds: profile.bounds.map((bound) => ({
      ...bound,
      min: [bound.min[0], bound.min[1], bound.min[2]],
      max: [bound.max[0], bound.max[1], bound.max[2]],
    })),
    viewProjection: profile.viewProjection ? [...profile.viewProjection] : null,
    ...(profile.instances
      ? {
          instances: {
            ...profile.instances,
            views: profile.instances.views.map((view) => ({ ...view })),
          },
        }
      : {}),
  };
}

/** Status line for frustum culling and the optional view-distance cutoff. */
export function visibilityCullingStatus(
  profile: CullingDiagnostics | undefined,
): string {
  if (!profile) return "waiting for the renderer";

  const frustum = profile.enabled
    ? "on · view frustums reject fully offscreen bounds"
    : "off · eligible objects are submitted without frustum rejection";

  return (
    frustum +
    (profile.distance?.range
      ? ` · view distance ${Math.round(profile.distance.range)} m, ${profile.distance.culled} batches beyond range, shadows kept`
      : "")
  );
}

/** Copies a profile and its passes so history and frozen views hold their own values. */
function copyGpuProfile(profile: GpuProfile): GpuProfile {
  return { ...profile, passes: profile.passes.map((pass) => ({ ...pass })) };
}

/** The renderer's current frame, else a ready sample's frame plus its age; null when unknown. */
function currentGpuFrame(profile: GpuProfile | undefined): number | null {
  if (!profile) return null;

  if (profile.currentFrame !== null) return profile.currentFrame;

  if (
    profile.status === gpuStatus.ready &&
    profile.sampleFrame !== null &&
    profile.sampleAgeFrames !== null
  )
    return profile.sampleFrame + profile.sampleAgeFrames;

  return null;
}

/** Names the frame a GPU sample came from: the matching diagnostic frame, else the renderer frame. */
function gpuFrameLabel(view: GpuProfile | undefined): string {
  if (view?.diagnosticFrame != null)
    return `from frame ${count(view.diagnosticFrame)}`;

  if (view?.sampleFrame != null)
    return `renderer frame ${count(view.sampleFrame)}`;

  return "";
}

/** Status line for the GPU timing source's current state. */
export function gpuTimingStatus(profile: GpuProfile | undefined): string {
  if (!profile) return "waiting for the renderer";

  switch (profile.status) {
    case gpuStatus.unsupported:
      return "unsupported · timestamp queries are unavailable on this device";

    case gpuStatus.disabled:
      return "off · gpu timing is disabled";

    case gpuStatus.pending:
      return "pending · waiting for asynchronous gpu timing";

    case gpuStatus.ready:
      return "ready · asynchronous gpu sample";

    case gpuStatus.error:
      return `error · ${profile.error ?? "gpu timing could not be read"}`;

    default: {
      const status: never = profile.status;

      return status;
    }
  }
}

/** Bounded asynchronous samples, identified by the renderer frame rather than UI refresh. */
export class GpuProfileHistory {
  private readonly recent: GpuProfile[] = [];
  private readonly recorded: GpuProfile[] = [];
  private lastSampleFrame = -1;
  private recordingStartFrame: number | null = null;
  private hasRecording = false;
  private discardedRecordedSamples = 0;
  private readonly recentCapacity: number;
  private readonly recordingCapacity: number;

  /** Capacities: samples kept while idle, and samples kept for one recording. */
  constructor(recentCapacity = 600, recordingCapacity = 6000) {
    this.recentCapacity = recentCapacity;
    this.recordingCapacity = recordingCapacity;
  }

  /** Begins a recording after the newest renderer frame seen, so older readbacks stay out. */
  start(profile: GpuProfile | undefined) {
    this.recorded.length = 0;
    this.discardedRecordedSamples = 0;
    this.hasRecording = true;

    const frame = currentGpuFrame(profile);

    this.recordingStartFrame =
      frame === null ? null : Math.max(this.lastSampleFrame, frame);
  }

  /** Keeps each new ready sample once, and adds it to the recording when it follows the start frame. */
  observe(profile: GpuProfile | undefined, recording: boolean) {
    // A renderer may become available after Record. Establish its boundary before
    // considering any readback, which can belong to an older submitted frame.
    if (recording && this.recordingStartFrame === null) {
      const frame = currentGpuFrame(profile);

      if (frame !== null)
        this.recordingStartFrame = Math.max(this.lastSampleFrame, frame);
    }

    if (
      !profile ||
      profile.status !== gpuStatus.ready ||
      profile.sampleFrame === null ||
      profile.sampleFrame <= this.lastSampleFrame
    )
      return;

    this.lastSampleFrame = profile.sampleFrame;
    this.recent.push(copyGpuProfile(profile));

    if (this.recent.length > this.recentCapacity) this.recent.shift();

    if (
      recording &&
      this.recordingStartFrame !== null &&
      profile.sampleFrame > this.recordingStartFrame
    ) {
      this.recorded.push(copyGpuProfile(profile));

      if (this.recorded.length > this.recordingCapacity) {
        this.recorded.shift();
        this.discardedRecordedSamples++;
      }
    }
  }

  /** Drops every sample and restarts from the renderer's current frame. */
  clear(profile: GpuProfile | undefined) {
    this.recent.length = this.recorded.length = 0;
    this.lastSampleFrame = profile?.sampleFrame ?? -1;
    this.recordingStartFrame = currentGpuFrame(profile);
    this.hasRecording = false;
    this.discardedRecordedSamples = 0;
  }

  /** Describes the held history: which one, its capacity, its size and the samples dropped. */
  summary() {
    return {
      history: this.hasRecording ? "recording" : "recent",
      sampleCapacity: this.hasRecording
        ? this.recordingCapacity
        : this.recentCapacity,
      discardedRecordedSamples: this.discardedRecordedSamples,
      sampleCount: (this.hasRecording ? this.recorded : this.recent).length,
    };
  }

  /** The GPU section of an exported recording: the summary, the latest profile and the held samples. */
  export(latest: GpuProfile | undefined) {
    return {
      units: "milliseconds" as const,
      measurement:
        "Asynchronous GPU timestamps; renderer frame numbers identify samples",
      ...this.summary(),
      latest: latest ? copyGpuProfile(latest) : null,
      samples: (this.hasRecording ? this.recorded : this.recent).map(
        copyGpuProfile,
      ),
    };
  }
}

export interface FrameStats {
  /** Frames that ended within the last second; null until a full second is held. */
  fps: number | null;
  /** The slowest and fastest of those one-second rates across the history; null like fps. */
  fpsRange: { low: number; high: number } | null;
  avg: number;
  p95: number;
  worst: number;
  worstFrame: number;
  missed: number;
  /** Over-budget line: the budget plus two ticks of the timer the intervals came from. */
  limitMs: number;
}

/**
 * The tiles' numbers over the retained history; p95 as the core computes it. Without a
 * core timer estimate, the over-budget line uses the tick observed in the intervals.
 */
export function frameStats(
  frames: readonly DiagnosticFrame[],
  budgetMs: number,
  timerMs: number | null,
): FrameStats | null {
  const last = frames.at(-1);

  if (!last) return null;

  const intervals = new Float64Array(frames.length);

  let sum = 0,
    worst = last,
    shown = 0;

  frames.forEach((frame, i) => {
    intervals[i] = frame.interval;

    sum += frame.interval;

    if (frame.interval > worst.interval) worst = frame;

    if (frame.at > last.at - msPerSecond) shown++;
  });

  intervals.sort();

  const limitMs = budgetLimit(budgetMs, timerMs ?? observedTick(intervals));

  let missed = 0;

  for (let i = intervals.length - 1; i >= 0 && intervals[i]! > limitMs; i--)
    missed++;

  const start = frames[0]!.at - frames[0]!.interval;

  // The rate the tile would have shown at each frame with a full second behind it.
  let low = Infinity,
    high = -Infinity;

  for (let i = 0, from = 0; i < frames.length; i++) {
    const end = frames[i]!.at;

    if (end - msPerSecond < start) continue;

    while (frames[from]!.at <= end - msPerSecond) from++;

    low = Math.min(low, i - from + 1);

    high = Math.max(high, i - from + 1);
  }

  return {
    fps: last.at - start >= msPerSecond ? shown : null,
    fpsRange: high >= low ? { low, high } : null,
    avg: sum / frames.length,
    p95: sortedP95(intervals),
    worst: worst.interval,
    worstFrame: worst.id,
    missed,
    limitMs,
  };
}

/** One sealed frame's exact scope time per system; null without complete scopes. */
export interface FrameScopes {
  systems: Map<string, { label: string; ms: number }>;
  unattributed: number;
}

/** Per-system CPU time for a frame with complete scopes; overlapping scopes count once. */
function frameScopes(frame: DiagnosticFrame): FrameScopes | null {
  if (frame.coverage !== completeCoverage) return null;

  const groups = scopesBySystem(frame.scopes);

  const systems = new Map<string, { label: string; ms: number }>();

  for (const [system, group] of groups)
    systems.set(system, { label: group[0]!.label, ms: intervalUnion(group) });

  return {
    systems,
    unattributed: Math.max(0, frame.interval - intervalUnion(frame.scopes)),
  };
}

/**
 * Exact per-frame CPU averages over the frames in view; nested scopes count once.
 * Sealed frames never change, so a cache keyed by frame ID does each frame once.
 */
export function scopeAverages(
  frames: readonly DiagnosticFrame[],
  cache?: Map<number, FrameScopes | null>,
) {
  const totals = new Map<string, { label: string; ms: number }>();

  let unattributed = 0,
    measured = 0;

  for (const frame of frames) {
    let scopes = cache?.get(frame.id);

    if (scopes === undefined) {
      scopes = frameScopes(frame);

      cache?.set(frame.id, scopes);
    }

    if (!scopes) continue;

    measured++;

    for (const [system, entry] of scopes.systems) {
      const total = totals.get(system);

      if (total) total.ms += entry.ms;
      else totals.set(system, { ...entry });
    }

    unattributed += scopes.unattributed;
  }

  for (const total of totals.values()) total.ms /= measured || 1;

  if (cache && frames.length && cache.size > frames.length * 2)
    for (const id of cache.keys()) if (id < frames[0]!.id) cache.delete(id);

  return {
    measured,
    systems: totals,
    unattributed: measured ? unattributed / measured : 0,
  };
}

export type PerformanceTrayMode = "line" | "mini" | "full";

type PerformanceTrayCorner =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left";

export interface PerformanceTrayOptions {
  /** Container in the current document; one panel per container. */
  shell: HTMLElement;
  monitor: Diagnostics;
  gpu?: PerformanceGpuSource;
  culling?: PerformanceCullingSource;
  temporal?: PerformanceTemporalSource;
  preparation?: PerformancePreparationSource;
  /** Size to open at when this origin has none remembered. Defaults to `line`. */
  mode?: PerformanceTrayMode;
  /** Viewport corner the panel docks to. Defaults to `top-right`. */
  corner?: PerformanceTrayCorner;
  /** Recording viewer page. When set, OPEN IN VIEWER hands recordings to it in a new window. */
  viewerUrl?: string;
  /** Window used by AUTO CAPTURE; unset values use the monitor's defaults. */
  capture?: AutoCaptureOptions;
}

const modeKey = "jank.js:panel-mode";

const trayMode = { line: "line", mini: "mini", full: "full" } as const;

const tabName = {
  live: "live",
  loading: "loading",
  capture: "capture",
} as const;

const editorKey = {
  threshold: "threshold",
  before: "before",
  after: "after",
  cooldown: "cooldown",
} as const;

const debugView = {
  none: "none",
  motion: "motion",
  history: "history",
} as const;

/** Auto capture states the header names while not recording. */
const shownCaptureStates = new Set<string>(["armed", "cooldown"]);

const freshContext = "fresh-context";

const mainView = "main";

const enterKey = "Enter";

const escapeKey = "Escape";

/** Tab keys move focus to the tab at the returned index. */
const tabMoves = new Map<string, (index: number, length: number) => number>([
  ["ArrowRight", (index, length) => (index + 1) % length],
  ["ArrowLeft", (index, length) => (index + length - 1) % length],
  ["Home", () => 0],
  ["End", (_, length) => length - 1],
]);

const viewerReady = "jank.js:viewer-ready";

/** An opaque origin, such as a file: page, serializes as "null". */
const opaqueOrigin = "null";

const captureLimit = 10;

const presetFps = { low: 30, standard: 60, high: 120 } as const;

/** Intervals around the trigger kept for a capture's thumbnail. */
const thumbnailFramesBefore = 13;

const thumbnailFramesAfter = 7;

const thumbnailWidth = 60;

const thumbnailHeight = 24;

/** CSS widths until the first ResizeObserver report. */
const defaultGraphWidth = 340;

const defaultMiniWidth = 236;

const graphHeight = 120;

const miniHeight = 36;

/** Room under the full graph for its axis labels. */
const graphLabelHeight = 20;

const recentEventLimit = 6;

const counterLimit = 12;

/** Line mode reads at 4 per s; the larger views at 10, or 4 while lowered. */
const slowRefreshMs = 250;

const fastRefreshMs = 100;

/** Mean refresh cost that lowers the redraw rate, and the cost that restores it. */
const lowerAboveMs = 0.25;

const restoreBelowMs = 0.1;

/** The panel size saved for this origin, when storage holds a valid one. */
function rememberedMode(): PerformanceTrayMode | undefined {
  try {
    const value = globalThis.localStorage?.getItem(modeKey);

    return value === trayMode.line ||
      value === trayMode.mini ||
      value === trayMode.full
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the panel size for this origin. */
function rememberMode(mode: PerformanceTrayMode) {
  try {
    globalThis.localStorage?.setItem(modeKey, mode);
  } catch {
    // Storage can be unavailable; the panel still works for this page.
  }
}

/** Shows or hides an element, writing only on change. */
function show(element: HTMLElement, visible: boolean) {
  if (element.hidden === visible) element.hidden = !visible;
}

/** Enables or disables a button, writing only on change. */
function disable(element: HTMLButtonElement, disabled: boolean) {
  if (element.disabled !== disabled) element.disabled = disabled;
}

/** The frames a graph of this width draws at its pitch. */
function inView(frames: readonly DiagnosticFrame[], canvasWidth: number) {
  return frames.slice(
    Math.max(0, frames.length - Math.floor(canvasWidth / graphPitch)),
  );
}

/** Status line for the LOADING tab: no source, nothing measured, or the current session. */
function preparationStatus(
  connected: boolean,
  current: PreparationSnapshot | null,
): string {
  if (!connected) return "no preparation source connected";

  if (!current) return "no loading measured yet";

  return `${current.label} · ${current.kind.replace("-", " ")} · ${current.status}${current.pending ? ` · ${current.pending} unfinished at cutoff` : ""} · stages overlap and do not add up to the session`;
}

interface Capture {
  number: number;
  frame: number;
  ms: number;
  near: string;
  json: string;
  bytes: number;
  intervals: number[];
}

interface Row {
  root: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
}

/** Required element lookup inside a row or capture entry. */
const part = (from: HTMLElement, selector: string) =>
  findIn(from, selector, HTMLElement);

/** Bars drawn beyond a graph's left edge, so a glide never reveals a gap. */
const glideFrames = 40;

let motionQuery: MediaQueryList | undefined;

/** True when the user's system asks for less motion; graphs then jump between redraws. */
function reducedMotion() {
  motionQuery ??= globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

  return motionQuery?.matches ?? false;
}

/**
 * Slides a graph's bars from where they were back to rest after each redraw, so they glide
 * instead of jumping. Only the motion is smoothed: every bar is a measured frame, drawn where
 * it belongs once the glide ends. The compositor runs the animation, so it costs no script.
 */
function glider(canvas: HTMLCanvasElement) {
  let newest = -1,
    drawnAt = 0,
    from = 0,
    duration = 0,
    animation: Animation | null = null;

  return (frameId: number | undefined, redrawMs: number) => {
    const now = performance.now();

    const steps = newest < 0 || frameId === undefined ? 0 : frameId - newest;

    // Distance still to travel from an unfinished glide, so motion carries on rather than jumping.
    const elapsed = animation?.currentTime;

    const carry =
      animation && typeof elapsed === "number" && duration
        ? from * Math.max(0, 1 - elapsed / duration)
        : 0;

    const gap = now - drawnAt;

    newest = frameId ?? -1;

    drawnAt = now;

    animation?.cancel();

    animation = null;

    if (steps <= 0 || reducedMotion() || typeof canvas.animate !== "function")
      return;

    from = Math.min(glideFrames * graphPitch, steps * graphPitch + carry);

    duration = Math.min(Math.max(gap, redrawMs), 2 * redrawMs);

    animation = canvas.animate(
      [{ transform: `translateX(${from}px)` }, { transform: "none" }],
      { duration, easing: "linear" },
    );
    // Start on this frame's clock: a new animation otherwise waits a frame, and the bars
    // would pause at every redraw.
    animation.startTime = document.timeline.currentTime;
  };
}

/** Unique ids when more than one panel mounts. */
let trayCount = 0;

const mountedShells = new WeakSet<HTMLElement>();

/** The host calls refresh from its existing frame loop and owns the monitor. */
export function createPerformanceTray(options: PerformanceTrayOptions) {
  const { shell, monitor, gpu, culling, temporal, preparation } = options;

  if (mountedShells.has(shell))
    throw new Error("A performance tray is already mounted in this container");

  const root = document.createElement("section");

  root.className = "jank jl";
  root.setAttribute("aria-label", "jank.js performance monitor");

  const id = `jank-${++trayCount}`;

  root.innerHTML = panelMarkup(id, {
    gpu: !!gpu,
    culling: !!culling,
    temporal: !!temporal,
    viewer: !!options.viewerUrl,
  });
  root.dataset["corner"] = options.corner ?? "top-right";

  /** Required element lookup inside this panel. */
  const find = <T extends HTMLElement>(selector: string, type: { new (): T }) =>
    findIn(root, selector, type);

  // Looked up once: a refresh writes through these without querying the DOM.
  const slots = new Map<string, HTMLElement>();

  /** The data-k element for a key, queried once and then cached. */
  const slot = (key: string) => {
    let element = slots.get(key);

    if (!element)
      slots.set(key, (element = find(`[data-k="${key}"]`, HTMLElement)));

    return element;
  };

  /** The data-action button with this name. */
  const action = (name: string) =>
    find(`[data-action="${name}"]`, HTMLButtonElement);

  const tabs = Object.values(tabName).map((name) => ({
    name,
    tab: find(`[data-tab="${name}"]`, HTMLButtonElement),
    panel: find(`[data-panel="${name}"]`, HTMLDivElement),
  }));

  const graphView = find('[data-k="graph-view"]', HTMLElement),
    graphCanvas = find('[data-k="graph"]', HTMLCanvasElement),
    graphText = find('[data-k="graph-text"]', HTMLCanvasElement);

  const miniView = find('[data-k="mini-view"]', HTMLElement),
    miniCanvas = find('[data-k="mini-graph"]', HTMLCanvasElement);

  const glideGraph = glider(graphCanvas),
    glideMini = glider(miniCanvas);

  const freezeButton = action("freeze"),
    freezeIcon = action("freeze-icon"),
    recordButton = action("record"),
    autoButton = action("auto"),
    gpuButton = action("gpu"),
    devtoolsButton = action("devtools"),
    cullingButton = action("culling"),
    instancesButton = action("instances"),
    boundsButton = action("bounds"),
    temporalButton = action("temporal"),
    viewerButton = action("viewer"),
    customButton = action("custom-fps");

  const temporalSelect = find(
    'select[aria-label="Temporal debug view"]',
    HTMLSelectElement,
  );

  const fpsInput = find('input[aria-label="Target FPS"]', HTMLInputElement);

  const presets = Object.values(presetFps).map((fps) => ({
    fps,
    button: find(`[data-fps="${fps}"]`, HTMLButtonElement),
  }));

  const editors = Object.values(editorKey).map((key) => ({
    key,
    button: find(`[data-edit="${key}"]`, HTMLButtonElement),
    input: find(`[data-input="${key}"]`, HTMLInputElement),
  }));

  /** The host's current loading session; a throwing source reads as none. */
  const readPreparation = () => {
    try {
      return preparation?.read() ?? null;
    } catch {
      return null;
    }
  };

  /** Past loading sessions; a throwing source reads as none. */
  const preparationHistory = () => {
    try {
      return preparation?.history() ?? [];
    } catch {
      return [];
    }
  };

  /** Temporal diagnostics; a throwing source reads as unavailable. */
  const readTemporal = (): TemporalDiagnostics | undefined => {
    try {
      return temporal?.read();
    } catch {
      return undefined;
    }
  };

  /** Culling diagnostics; a throwing source reads as unavailable. */
  const readCulling = (): CullingDiagnostics | undefined => {
    try {
      return culling?.read();
    } catch {
      return undefined;
    }
  };

  /** GPU timing; a throwing source becomes an error profile the panel can show. */
  const readGpu = (): GpuProfile | undefined => {
    if (!gpu) return undefined;

    try {
      return gpu.read();
    } catch (error) {
      return {
        available: true,
        enabled: gpuRequested,
        status: "error",
        currentFrame: null,
        sampleFrame: null,
        sampleAgeFrames: null,
        gpuMilliseconds: null,
        passes: [],
        droppedFrames: 0,
        truncatedPasses: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const gpuHistory = new GpuProfileHistory();

  const abort = new AbortController();

  const listen = { signal: abort.signal };

  let disposed = false,
    mode: PerformanceTrayMode = rememberedMode() ?? options.mode ?? "line",
    tab: (typeof tabs)[number]["name"] = "live",
    frozen = false,
    dirty = true,
    lastRefresh = -Infinity,
    lowered = false,
    wasRecording = false,
    gpuRequested = false,
    devtoolsRequested = false,
    autoRequested = false,
    cullingRequested = true,
    cullingDebugRequested = false,
    objectMotionRequested = true,
    temporalDebugRequested: TemporalDebugView = "none",
    budgetMs = msPerSecond / presetFps.standard,
    targetFps: number = presetFps.standard,
    theme: GraphTheme | undefined,
    stats: FrameStats | null = null,
    graphWidth = defaultGraphWidth,
    miniWidth = defaultMiniWidth;

  let frozenSnapshot: DiagnosticSnapshot | undefined;

  let frozenGpu: GpuProfile | undefined;

  let frozenCulling: CullingDiagnostics | undefined;

  let frozenTemporal: TemporalDiagnostics | undefined;

  let frozenPreparation: PreparationSnapshot | null = null;

  let frozenPreparationHistory: readonly PreparationSnapshot[] = [];

  const captureWindow = {
    thresholdMs: options.capture?.thresholdMs,
    beforeFrames: options.capture?.beforeFrames ?? defaultBeforeFrames,
    afterFrames: options.capture?.afterFrames ?? defaultAfterFrames,
    cooldownMs: options.capture?.cooldownMs ?? defaultCooldownMs,
  };

  const captures: Capture[] = [];

  const scopeCache = new Map<number, FrameScopes | null>();

  let capturesShown = -1,
    capturesMade = 0;

  // Text and attribute writes are skipped when unchanged, so a steady panel writes nothing.
  const written = new WeakMap<object, Map<string, string>>();

  /** Records the last value written per element and key; false when it hasn't changed. */
  const changed = (element: object, key: string, value: string) => {
    let values = written.get(element);

    if (!values) written.set(element, (values = new Map()));

    if (values.get(key) === value) return false;

    values.set(key, value);

    return true;
  };

  /** Sets text content when it changed. */
  const put = (element: HTMLElement, value: string) => {
    if (changed(element, "text", value)) element.textContent = value;
  };

  /** Sets an attribute when it changed. */
  const flag = (element: HTMLElement, name: string, value: string) => {
    if (changed(element, name, value)) element.setAttribute(name, value);
  };

  /** Sets the data-tone colour hint when it changed. */
  const tone = (element: HTMLElement, value: string) => {
    if (changed(element, "tone", value)) element.dataset["tone"] = value;
  };

  /** Sets a bar's width as a clamped percentage when it changed. */
  const width = (element: HTMLElement, fraction: number) => {
    const value = `${(Math.min(1, Math.max(0, fraction)) * percent).toFixed(1)}%`;

    if (changed(element, "width", value)) element.style.width = value;
  };

  /** Shows a toggle's state as ON/OFF text and aria-pressed. */
  const pressed = (element: HTMLButtonElement, on: boolean) => {
    flag(element, "aria-pressed", String(on));

    put(element, on ? "ON" : "OFF");
  };

  /** Builds one label, bar and value row. */
  const row = (className: string): Row => {
    const element = document.createElement("div");

    element.className = className;
    element.innerHTML =
      '<span class="jank-k"></span><span class="jank-lead"><i></i></span><span class="jank-v"></span>';

    return {
      root: element,
      label: part(element, ".jank-k"),
      fill: part(element, ".jank-lead i"),
      value: part(element, ".jank-v"),
    };
  };

  /** Rows are created only when a list grows, never per refresh. */
  const pool = (container: HTMLElement, make: () => Row) => {
    const rows: Row[] = [];

    return (length: number) => {
      while (rows.length < length) {
        const next = make();

        rows.push(next);

        container.append(next.root);
      }

      while (rows.length > length) rows.pop()!.root.remove();

      return rows;
    };
  };

  const cpuRows = pool(slot("cpu"), () => row("jank-row"));

  const gpuRows = pool(slot("gpu"), () => row("jank-row jank-dashed"));

  const counterRows = pool(slot("counters"), () => row("jank-kv"));

  const cullingRows = pool(slot("culling-rows"), () => row("jank-kv"));

  // A stage row's `value` is the cold run's ghost bar, drawn behind the current one.
  const stageRows = pool(slot("stages"), () => {
    const element = document.createElement("div");

    element.className = "jank-stage";
    element.innerHTML =
      '<span class="jank-k"></span><span class="jank-track"><i class="jank-ghost"></i><i class="jank-bar"></i></span>';

    return {
      root: element,
      label: part(element, ".jank-k"),
      fill: part(element, ".jank-bar"),
      value: part(element, ".jank-ghost"),
    };
  });

  const cacheRows = pool(slot("cache-rows"), () => row("jank-row"));

  const sessionRows = pool(slot("sessions"), () => row("jank-row"));

  const eventItems = pool(slot("events"), () => {
    const item = document.createElement("li");

    return { root: item, label: item, fill: item, value: item };
  });

  let honesty = { cpu: "", gpu: "gpu timer unknown" },
    timerMs: number | null = null;

  try {
    const environment = monitor.export().metadata.environment;

    honesty = timerHonesty(environment);

    timerMs = environment.cpuTimer.estimatedResolutionMs;
  } catch {
    // A disposed monitor keeps the default statement.
  }

  mountedShells.add(shell);

  shell.classList.add("jank-host");
  shell.append(root);

  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const next = Math.floor(entry.contentRect.width);

        if (entry.target === graphView && next) graphWidth = next;

        if (entry.target === miniView && next) miniWidth = next;
      }

      dirty = true;
    });

    sizes.observe(graphView);
    sizes.observe(miniView);

    abort.signal.addEventListener("abort", () => sizes.disconnect());
  }

  /** Only a size the user picks is remembered; the host's initial mode is not. */
  function setMode(next: PerformanceTrayMode, chosen = false) {
    mode = next;

    root.dataset["mode"] = next;

    if (chosen) rememberMode(next);

    monitor.setExpanded(next !== trayMode.line);

    theme = undefined;

    dirty = true;

    lastRefresh = -Infinity;

    if (!chosen) return;

    const target =
      next === trayMode.full
        ? tabs.find((entry) => entry.name === tab)!.tab
        : action(next === trayMode.mini ? "mini-grow" : "line-grow");

    target.focus?.();
  }

  /** Selects a tab, updates its ARIA state and makes the next refresh draw. */
  function setTab(next: typeof tab, focus = false) {
    tab = next;

    root.dataset["tab"] = next;

    for (const entry of tabs) {
      const selected = entry.name === next;

      flag(entry.tab, "aria-selected", String(selected));

      flag(entry.tab, "tabindex", selected ? "0" : "-1");

      show(entry.panel, selected);

      if (selected && focus) entry.tab.focus?.();
    }

    dirty = true;

    lastRefresh = -Infinity;
  }

  setMode(mode);

  setTab("live");

  /** Adds a listener that is removed when the panel is disposed. */
  const on = <K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    name: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ) => element.addEventListener(name, listener, listen);

  /** Redraws now instead of waiting for the next due refresh. */
  const redraw = () => {
    dirty = true;

    lastRefresh = -Infinity;

    refresh(performance.now());
  };

  on(action("line-grow"), "click", () => setMode("full", true));

  on(action("mini-grow"), "click", () => setMode("full", true));

  on(action("mini-shrink"), "click", () => setMode("line", true));

  on(action("full-shrink"), "click", () => setMode("mini", true));

  for (const entry of tabs) {
    on(entry.tab, "click", () => setTab(entry.name));

    on(entry.tab, "keydown", (event) => {
      const move = tabMoves.get(event.key);

      if (!move) return;

      event.preventDefault();

      setTab(tabs[move(tabs.indexOf(entry), tabs.length)]!.name, true);
    });
  }

  /** Freezes or resumes the display, holding copies of every source while frozen. */
  function toggleFreeze() {
    frozen = !frozen;

    frozenSnapshot = frozen ? monitor.snapshot() : undefined;

    frozenPreparation = frozen ? readPreparation() : null;

    frozenPreparationHistory = frozen ? preparationHistory() : [];

    const profile = readGpu();

    frozenGpu = frozen && profile ? copyGpuProfile(profile) : undefined;

    const visibility = readCulling();

    frozenCulling =
      frozen && visibility ? copyCullingDiagnostics(visibility) : undefined;

    const reconstruction = readTemporal();

    frozenTemporal =
      frozen && reconstruction
        ? copyTemporalDiagnostics(reconstruction)
        : undefined;

    for (const button of [freezeButton, freezeIcon])
      flag(button, "aria-pressed", String(frozen));

    put(freezeButton, frozen ? "RESUME" : "FREEZE");

    flag(
      freezeIcon,
      "aria-label",
      frozen ? "Resume display" : "Freeze display",
    );

    redraw();
  }

  on(freezeButton, "click", toggleFreeze);

  on(freezeIcon, "click", toggleFreeze);

  on(recordButton, "click", () => {
    const profile = readGpu();

    if (monitor.recording) {
      gpuHistory.observe(profile, true);

      monitor.stopRecording();
    } else {
      gpuHistory.start(profile);

      monitor.startRecording();
    }

    wasRecording = monitor.recording;

    redraw();
  });

  on(action("clear"), "click", () => {
    monitor.clear();

    const profile = readGpu();

    gpuHistory.clear(profile);

    if (monitor.recording) gpuHistory.start(profile);

    captures.length = 0;

    if (frozen) {
      frozenSnapshot = monitor.snapshot();

      frozenGpu = profile ? copyGpuProfile(profile) : undefined;

      const visibility = readCulling();

      frozenCulling = visibility
        ? copyCullingDiagnostics(visibility)
        : undefined;

      const reconstruction = readTemporal();

      frozenTemporal = reconstruction
        ? copyTemporalDiagnostics(reconstruction)
        : undefined;
    }

    redraw();
  });

  /** The recording plus host sections, exactly as EXPORT JSON writes it. */
  function exported() {
    const profile = readGpu();

    gpuHistory.observe(profile, monitor.recording || wasRecording);

    if (profile) monitor.observeGpu(profile);

    const data = monitor.export();

    const exportedGpu = gpuHistory.export(profile);

    // Linked GPU frames use the same pre/post window as CPU capture, including
    // asynchronous readbacks received after the trigger or stop boundary.
    if (
      profile?.diagnosticFrame != null ||
      data.gpu?.samples.some((sample) => sample.diagnosticFrame != null)
    ) {
      exportedGpu.samples = data.gpu?.samples ?? [];
      exportedGpu.sampleCount = exportedGpu.samples.length;
    }

    const visibility = readCulling();

    const reconstruction = readTemporal();

    return {
      ...data,
      ...(preparation
        ? {
            preparation: {
              units: "milliseconds" as const,
              measurement:
                "Elapsed CPU and asynchronous preparation waits; overlapping stages are not additive. Fresh contexts do not clear OS or driver caches.",
              current: readPreparation(),
              history: preparationHistory(),
            },
          }
        : {}),
      ...(gpu
        ? {
            gpuTiming:
              "Asynchronous GPU timestamps in gpu.samples; CPU submission is measured separately",
            gpu: exportedGpu,
          }
        : {}),
      ...(culling
        ? {
            culling: {
              enabled: visibility?.enabled ?? cullingRequested,
              debugBounds: visibility?.debugBounds ?? cullingDebugRequested,
              latest: visibility ? copyCullingDiagnostics(visibility) : null,
            },
          }
        : {}),
      ...(temporal
        ? {
            temporal: {
              objectMotion:
                reconstruction?.objectMotion ?? objectMotionRequested,
              debugView: reconstruction?.debugView ?? temporalDebugRequested,
              latest: reconstruction
                ? copyTemporalDiagnostics(reconstruction)
                : null,
            },
          }
        : {}),
    };
  }

  /** The recording as JSON, or undefined with the export error shown. */
  function serialized(error: HTMLElement): string | undefined {
    try {
      const json = serializeRecording(exported());

      show(error, false);

      return json;
    } catch (caught) {
      put(
        error,
        `export unavailable: ${caught instanceof Error ? caught.message : String(caught)}. the recording is still held.`,
      );

      show(error, true);

      return undefined;
    }
  }

  /** Opens the viewer window and sends it the recording once it announces it is ready. */
  function openInViewer(json: string, name: string, error: HTMLElement) {
    const url = options.viewerUrl;

    if (!url) return;

    const target = window.open(url, "_blank");

    if (!target) {
      put(error, "the browser blocked the viewer window");

      show(error, true);

      return;
    }

    /** The viewer announces itself; only the window opened here receives the recording. */
    const handoff = (event: MessageEvent) => {
      const data: unknown = event.data;

      if (
        event.source !== target ||
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        data.type !== viewerReady
      )
        return;

      target.postMessage(
        { type: "jank.js:recording", name, json },
        event.origin === opaqueOrigin ? "*" : event.origin,
      );

      removeEventListener("message", handoff);
    };

    addEventListener("message", handoff, listen);
  }

  const liveError = slot("live-error"),
    captureError = slot("capture-error");

  on(action("export"), "click", () => {
    const json = serialized(liveError);

    if (json) download(json, "jank-recording.json");
  });

  on(action("export-capture"), "click", () => {
    const json = serialized(captureError);

    if (json) download(json, "jank-recording.json");
  });

  on(viewerButton, "click", () => {
    const json = serialized(captureError);

    if (json) openInViewer(json, "jank-recording.json", captureError);
  });

  // Budget: presets, or a typed custom target.

  /** Sets the frame budget from a target fps, re-arming auto capture so a derived threshold follows it. */
  function setTarget(fps: number) {
    monitor.setTargetFps(fps);

    targetFps = fps;

    budgetMs = msPerSecond / fps;

    if (autoRequested) monitor.armCapture(coreWindow());

    redraw();
  }

  for (const preset of presets)
    on(preset.button, "click", () => setTarget(preset.fps));

  /** An invalid value keeps the field open and marked; the budget stays as it was. */
  function closeCustom(commit: boolean) {
    if (fpsInput.hidden) return true;

    const value = fpsInput.valueAsNumber;

    if (
      commit &&
      !(Number.isFinite(value) && value >= 1 && value <= maxTargetFps)
    ) {
      flag(fpsInput, "aria-invalid", "true");

      put(slot("budget-ms"), `1 to ${maxTargetFps} fps`);

      return false;
    }

    flag(fpsInput, "aria-invalid", "false");

    show(fpsInput, false);

    show(customButton, true);

    if (commit) setTarget(value);
    else redraw();

    return true;
  }

  on(customButton, "click", () => {
    fpsInput.value = String(Number(targetFps.toFixed(2)));

    show(customButton, false);

    show(fpsInput, true);

    fpsInput.focus?.();
    fpsInput.select?.();
  });

  // The key is the panel's own: keep its keypress from activating the button focused next.
  on(fpsInput, "keydown", (event) => {
    if (event.key !== enterKey && event.key !== escapeKey) return;

    event.preventDefault();

    if (closeCustom(event.key === enterKey)) customButton.focus?.();
  });

  on(fpsInput, "blur", () => {
    if (!closeCustom(true)) closeCustom(false);
  });

  // Auto capture window, edited in place: Enter commits, Escape reverts.

  /** The panel's capture window as core options; an unset threshold is left out so the core derives it. */
  function coreWindow(): AutoCaptureOptions {
    return {
      ...(captureWindow.thresholdMs === undefined
        ? {}
        : { thresholdMs: captureWindow.thresholdMs }),
      beforeFrames: captureWindow.beforeFrames,
      afterFrames: captureWindow.afterFrames,
      cooldownMs: captureWindow.cooldownMs,
    };
  }

  on(autoButton, "click", () => {
    autoRequested = !autoRequested;

    if (autoRequested) monitor.armCapture(coreWindow());
    else monitor.disarmCapture();

    redraw();
  });

  /** The value an editor's input opens with, in that editor's unit. */
  const editValue = (key: (typeof editors)[number]["key"]) =>
    ({
      threshold: Number((captureWindow.thresholdMs ?? budgetMs * 2).toFixed(2)),
      before: captureWindow.beforeFrames,
      after: captureWindow.afterFrames,
      cooldown: captureWindow.cooldownMs / msPerSecond,
    })[key];

  /** Applies an edited capture setting when valid and re-arms auto capture; false rejects it. */
  function accept(key: (typeof editors)[number]["key"], value: number) {
    if (!Number.isFinite(value) || value < 0) return false;

    if (key === editorKey.threshold) {
      if (value <= 0) return false;

      captureWindow.thresholdMs = value;
    } else if (key === editorKey.cooldown)
      captureWindow.cooldownMs = value * msPerSecond;
    else {
      const limit = key === editorKey.before ? maxBeforeFrames : maxAfterFrames;

      if (!Number.isInteger(value) || value > limit) return false;

      if (key === editorKey.before) captureWindow.beforeFrames = value;
      else captureWindow.afterFrames = value;
    }

    if (autoRequested) monitor.armCapture(coreWindow());

    return true;
  }

  for (const editor of editors) {
    /** Closes the editor, committing first when asked; false keeps it open on an invalid value. */
    const close = (commit: boolean) => {
      if (editor.input.hidden) return true;

      if (commit && !accept(editor.key, editor.input.valueAsNumber)) {
        flag(editor.input, "aria-invalid", "true");

        return false;
      }

      flag(editor.input, "aria-invalid", "false");

      show(editor.input, false);

      show(editor.button, true);

      redraw();

      return true;
    };

    on(editor.button, "click", () => {
      editor.input.value = String(editValue(editor.key));

      show(editor.button, false);

      show(editor.input, true);

      editor.input.focus?.();
      editor.input.select?.();
    });

    on(editor.input, "keydown", (event) => {
      if (event.key !== enterKey && event.key !== escapeKey) return;

      event.preventDefault();

      if (close(event.key === enterKey)) editor.button.focus?.();
    });

    // Leaving the field keeps a valid value and reverts an invalid one.
    on(editor.input, "blur", () => {
      if (!close(true)) close(false);
    });
  }

  on(gpuButton, "click", () => {
    gpuRequested = !(readGpu()?.enabled ?? gpuRequested);

    gpu?.setEnabled(gpuRequested);

    redraw();
  });

  on(devtoolsButton, "click", () => {
    devtoolsRequested = !devtoolsRequested;

    monitor.setDevToolsEnabled(devtoolsRequested);

    redraw();
  });

  on(cullingButton, "click", () => {
    cullingRequested = !(readCulling()?.enabled ?? cullingRequested);

    culling?.setEnabled(cullingRequested);

    redraw();
  });

  on(instancesButton, "click", () => {
    const enabled = readCulling()?.instances?.enabled ?? true;

    culling?.setInstancesEnabled?.(!enabled);

    redraw();
  });

  on(boundsButton, "click", () => {
    cullingDebugRequested = !(
      readCulling()?.debugBounds ?? cullingDebugRequested
    );

    culling?.setDebugBounds(cullingDebugRequested);

    redraw();
  });

  on(temporalButton, "click", () => {
    objectMotionRequested = !(
      readTemporal()?.objectMotion ?? objectMotionRequested
    );

    temporal?.setEnabled(objectMotionRequested);

    redraw();
  });

  on(temporalSelect, "change", () => {
    const view = temporalSelect.value;

    if (
      view !== debugView.none &&
      view !== debugView.motion &&
      view !== debugView.history
    )
      return;

    temporalDebugRequested = view;

    temporal?.setDebugView(view);

    redraw();
  });

  on(action("summary"), "click", () => {
    const parts = stats
      ? [
          stats.fps === null ? "fps unknown" : `${stats.fps} fps`,
          `${fixed(stats.avg)} ms average`,
          `p95 ${fixed(stats.p95)} ms`,
          `worst ${fixed(stats.worst)} ms at frame ${count(stats.worstFrame)}`,
          `${count(stats.missed)} frames over the ${fixed(budgetMs)} ms budget`,
        ]
      : ["no frames yet"];

    if (monitor.recording) parts.push("recording");

    if (frozen) parts.push("display frozen");

    put(slot("summary"), parts.join(", "));
  });

  // Panel input never reaches host shortcuts; the panel prevents no host defaults.
  for (const name of ["keydown", "keyup", "pointerdown", "wheel"] as const)
    root.addEventListener(name, (event) => event.stopPropagation(), listen);

  /** Keep a completed automatic capture; the monitor itself holds only the latest. */
  function keepCapture() {
    if (
      !autoRequested ||
      monitor.snapshot(false).capture.mode !== automaticCapture
    )
      return;

    let data: PerformanceRecording, json: string;

    try {
      data = exported();

      json = serializeRecording(data);
    } catch (caught) {
      put(
        captureError,
        `capture not kept: ${caught instanceof Error ? caught.message : String(caught)}`,
      );

      show(captureError, true);

      return;
    }

    const index = data.frames.findIndex(
      (frame) => frame.id === data.capture.triggerFrame,
    );

    const trigger = data.frames[index];

    if (!trigger) return;

    captures.push({
      number: ++capturesMade,
      frame: trigger.id,
      ms: trigger.interval,
      near: nearbyEventLabels(data, index),
      json,
      bytes: new TextEncoder().encode(json).byteLength,
      intervals: data.frames
        .slice(
          Math.max(0, index - thumbnailFramesBefore),
          index + thumbnailFramesAfter,
        )
        .map((frame) => frame.interval),
    });

    if (captures.length > captureLimit) captures.shift();
  }

  /** Called from the host's frame loop; the monitor times the panel's own work. */
  function refresh(at: number) {
    if (disposed) return;

    monitor.measureRefresh(() => refreshView(at));
  }

  /** Collects GPU samples and finished recordings every frame, and redraws when a refresh is due. */
  function refreshView(at: number) {
    if (disposed) return;

    // Collect each completed renderer frame while recording, even with the view frozen.
    const due =
      at - lastRefresh >=
      (mode === trayMode.line || lowered ? slowRefreshMs : fastRefreshMs);

    const profile =
      gpu && (monitor.recording || wasRecording || due) ? readGpu() : undefined;

    if (monitor.recording && !wasRecording) gpuHistory.start(profile);

    gpuHistory.observe(profile, monitor.recording || wasRecording);

    if (profile) monitor.observeGpu(profile);

    if (wasRecording && !monitor.recording) keepCapture();

    wasRecording = monitor.recording;

    if (!due) return;

    lastRefresh = at;

    render(profile);
  }

  /** Redraws the header and whichever size and tab is showing. */
  function render(profile: GpuProfile | undefined) {
    const recording = monitor.recording;

    flag(root, "data-recording", String(recording));

    put(recordButton, recording ? "STOP REC" : "REC");

    for (const key of ["rec-chip", "line-rec", "mini-rec"])
      show(slot(key), recording);

    renderControls(profile);

    if (frozen && !dirty) return;

    dirty = false;

    const snapshot =
      frozenSnapshot ??
      monitor.snapshot(mode === trayMode.full && tab === tabName.live);

    if (!frozen) {
      budgetMs = snapshot.budget.frameMs;

      targetFps = snapshot.budget.targetFps;
    }

    const frames = snapshot.frames;

    flag(root, "data-samples", String(frames.length));

    stats = frameStats(frames, budgetMs, timerMs);

    put(slot("state"), headerState(snapshot));

    if (mode === trayMode.line) renderLine();
    else if (mode === trayMode.mini) renderMini(frames);
    else {
      put(slot("budget"), fixed(budgetMs));

      if (tab === tabName.live) renderLive(snapshot, profile);
      else if (tab === tabName.loading) renderLoading();
      else renderCapture();

      renderOverhead(snapshot);
    }
  }

  /** Header text: frozen, recording progress, the auto capture state, or the loading session. */
  function headerState(snapshot: DiagnosticSnapshot) {
    if (frozen) return "FROZEN";

    const capture = snapshot.capture;

    if (monitor.recording) {
      const limit =
        capture.mode === automaticCapture
          ? capture.beforeFrames + 1 + capture.afterFrames
          : recordingFrameCapacity;

      return `${count(snapshot.recordedFrames)} / ${count(limit)}`;
    }

    if (shownCaptureStates.has(capture.state)) return capture.state;

    const session = tab === tabName.loading ? readPreparation() : null;

    return session ? `session ${session.id}` : "";
  }

  /** Over budget beyond what the timer can resolve; see frameStats. */
  const limit = () => stats?.limitMs ?? budgetLimit(budgetMs, timerMs);

  /** True when a time is past the over-budget line. */
  function over(value: number) {
    return value > limit();
  }

  /** Fills the line size: fps, average and worst frame. */
  function renderLine() {
    put(slot("line-fps"), stats?.fps == null ? "–" : String(stats.fps));

    put(slot("line-ms"), stats ? fixed(stats.avg) : "–");

    // Over budget reads as orange plus ▲ (drawn by the stylesheet), never colour alone.
    const worst = slot("line-worst");

    const miss = !!stats && over(stats.worst);

    put(worst, stats ? fixed(stats.worst) : "–");

    tone(worst, miss ? "miss" : "");

    show(slot("line-worst-unit"), !miss);
  }

  /** Fills the mini size: stats, the heaviest CPU scope and the small graph. */
  function renderMini(frames: readonly DiagnosticFrame[]) {
    put(slot("mini-fps"), stats?.fps == null ? "–" : String(stats.fps));

    put(slot("mini-ms"), stats ? fixed(stats.avg) : "–");

    const p95 = slot("mini-p95");

    put(p95, stats ? fixed(stats.p95) : "–");

    tone(p95, stats && over(stats.p95) ? "miss" : "");

    const worst = slot("mini-worst");

    put(worst, stats ? fixed(stats.worst) : "");

    tone(worst, stats && over(stats.worst) ? "miss" : "");

    put(slot("mini-worst-at"), stats ? ` at ${count(stats.worstFrame)}` : "");

    const scopes = scopeAverages(inView(frames, miniWidth), scopeCache);

    let top: { label: string; ms: number } | undefined;

    for (const system of scopes.systems.values())
      if (!top || system.ms > top.ms) top = system;

    const label = slot("mini-top");

    show(slot("mini-top-row"), !!top);

    put(label, top ? top.label.split(" ")[0]! : "");

    put(slot("mini-top-ms"), top ? fixed(top.ms) : "");

    flag(label, "title", top ? `heaviest cpu scope: ${top.label}` : "");

    draw(miniCanvas, null, miniWidth, miniHeight, frames, false);

    glideMini(frames.at(-1)?.id, redrawMs());
  }

  /** The redraw period the panel is running at now, which a glide spans. */
  const redrawMs = () =>
    mode === trayMode.line || lowered ? slowRefreshMs : fastRefreshMs;

  /**
   * Draws the frame-time graph: bars on a canvas wider than its view, so they can glide, and
   * labels, when asked, on a fixed canvas over them.
   */
  function draw(
    canvas: HTMLCanvasElement,
    text: HTMLCanvasElement | null,
    canvasWidth: number,
    height: number,
    frames: readonly DiagnosticFrame[],
    labels: boolean,
    events: readonly DiagnosticEvent[] = [],
  ) {
    const margin = glideFrames * graphPitch;

    const context = prepareCanvas(canvas, canvasWidth + margin, height);

    if (!context) return;

    const cssWidth = `${canvasWidth + margin}px`;

    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;

    theme ??= graphTheme(root);

    drawFrameGraph(
      context,
      text ? prepareCanvas(text, canvasWidth, height) : null,
      theme,
      frames,
      budgetMs,
      limit(),
      {
        width: canvasWidth,
        margin,
        height: labels ? height - graphLabelHeight : height,
        pitch: graphPitch,
        bar: 2,
        labels,
        budgetColor: labels ? theme.text : theme.muted,
      },
      events,
    );
  }

  /** The FPS tile's range: the slowest and fastest one-second rates, with the current one marked. */
  function renderFpsRange() {
    const current = stats,
      range = slot("fps-range");

    const shown = current?.fps != null && current.fpsRange !== null;

    show(range, shown);

    if (!shown) return;

    const { low, high } = current.fpsRange!;

    put(slot("fps-high"), String(high));

    put(slot("fps-low"), String(low));

    flag(range, "aria-label", `frame rate ranged from ${low} to ${high} fps`);

    // The top of the line is the fastest rate, the bottom the slowest; an even range sits mid-way.
    const fraction = high > low ? (high - current.fps!) / (high - low) : 1 / 2;

    const top = `${(fraction * percent).toFixed(1)}%`;

    const mark = slot("fps-mark");

    if (changed(mark, "top", top)) mark.style.top = top;
  }

  /** Fills the LIVE tab: tiles, graph, events, CPU scopes, GPU, counters, culling and temporal. */
  function renderLive(
    snapshot: DiagnosticSnapshot,
    profile: GpuProfile | undefined,
  ) {
    const tiles: [string, string, boolean][] = stats
      ? [
          ["fps", stats.fps === null ? "–" : String(stats.fps), false],
          ["avg", fixed(stats.avg), over(stats.avg)],
          ["p95", fixed(stats.p95), over(stats.p95)],
          ["worst", fixed(stats.worst), over(stats.worst)],
          ["worst-at", count(stats.worstFrame), false],
          ["missed", count(stats.missed), false],
        ]
      : ["fps", "avg", "p95", "worst", "worst-at", "missed"].map((key) => [
          key,
          "–",
          false,
        ]);

    for (const [key, value, miss] of tiles) {
      const element = slot(key);

      put(element, value);

      tone(element, miss ? "miss" : "");
    }

    renderFpsRange();

    flag(
      slot("missed"),
      "title",
      `frames longer than ${fixed(limit(), 2)} ms: the budget plus two timer ticks`,
    );

    const frames = snapshot.frames;

    draw(
      graphCanvas,
      graphText,
      graphWidth,
      graphHeight,
      frames,
      true,
      snapshot.events,
    );

    glideGraph(frames.at(-1)?.id, redrawMs());

    const recent = snapshot.events.slice(-recentEventLimit).toReversed();

    eventItems(Math.max(1, recent.length)).forEach((item, i) => {
      const event = recent[i];

      put(
        item.root,
        event
          ? `${(event.at / msPerSecond).toFixed(1)} s ${iconLabel(event.label)}${event.detail ? ` · ${event.detail}` : ""}`
          : "no events",
      );
    });

    // CPU: exact scopes over the frames drawn above.
    const scopes = scopeAverages(inView(frames, graphWidth), scopeCache);

    // Registration order; systems that only supply counters and were never timed stay out.
    const order = snapshot.systems.length
      ? snapshot.systems
          .filter((system) => scopes.systems.has(system.id) || system.peak > 0)
          .map((system) => ({ id: system.id, label: system.label }))
      : [...scopes.systems].map(([system, total]) => ({
          id: system,
          label: total.label,
        }));

    let heaviest = "";

    for (const entry of order)
      if (
        (scopes.systems.get(entry.id)?.ms ?? 0) >
        (scopes.systems.get(heaviest)?.ms ?? 0)
      )
        heaviest = entry.id;

    const cpuNote = slot("cpu-note");

    show(cpuNote, !scopes.measured);

    put(
      cpuNote,
      "no scoped frames in view yet. scopes start when the panel opens.",
    );

    const named = scopes.measured ? order : [];

    const rows = cpuRows(scopes.measured ? named.length + 1 : 0);

    named.forEach((entry, i) => {
      const ms = scopes.systems.get(entry.id)?.ms ?? 0;

      const target = rows[i]!;

      put(target.label, entry.label);

      put(target.value, fixed(ms));

      width(target.fill, ms / budgetMs);

      tone(target.root, entry.id === heaviest ? "heavy" : "");

      flag(
        target.root,
        "title",
        `${entry.label} · ${fixed(ms, 2)} ms avg over ${scopes.measured} frames`,
      );
    });

    const rest = rows[named.length];

    if (rest) {
      put(rest.label, "unattributed");

      put(rest.value, fixed(scopes.unattributed));

      width(rest.fill, scopes.unattributed / budgetMs);

      tone(rest.root, "dim");

      flag(
        rest.root,
        "title",
        "frame interval outside every scope: browser work, scheduling, waiting or idle, not only uninstrumented code",
      );
    }

    if (gpu) {
      const view = frozen ? frozenGpu : profile;

      put(slot("gpu-src"), gpu.label ?? "renderer");

      put(slot("gpu-frame"), gpuFrameLabel(view));

      const ready = view?.status === gpuStatus.ready;

      const passes = ready ? view.passes : [];

      gpuRows(passes.length).forEach((target, i) => {
        const pass = passes[i]!;

        put(target.label, pass.label);

        put(
          target.value,
          pass.milliseconds === null ? "unknown" : fixed(pass.milliseconds),
        );

        width(target.fill, (pass.milliseconds ?? 0) / budgetMs);
      });

      const status = slot("gpu-status");

      const captured = gpuHistory.summary();

      put(
        status,
        ready
          ? `${captured.sampleCount} ${captured.history} samples · ${view.droppedFrames} skipped · ${view.truncatedPasses} passes omitted`
          : gpuTimingStatus(view),
      );
    }

    const values = snapshot.systems.flatMap((system) =>
      Object.entries(system.values).map(([key, value]) => ({
        key: words(key),
        value: counter(value),
        source: system.label,
      })),
    );

    const sources = counterSources(snapshot.systems);

    const counterSource = slot("counter-src");

    put(counterSource, sources.join(" · "));

    const shown = values.slice(0, counterLimit);

    counterRows(shown.length).forEach((target, i) => {
      put(target.label, shown[i]!.key);

      put(target.value, shown[i]!.value);

      flag(target.root, "title", `${shown[i]!.source} · ${shown[i]!.key}`);
    });

    const counterNote = slot("counter-note");

    show(counterNote, values.length !== shown.length || !values.length);

    put(
      counterNote,
      values.length
        ? `${values.length - shown.length} more in the export`
        : "no counters registered",
    );

    if (culling) renderCulling();

    if (temporal) {
      const view = frozen ? frozenTemporal : readTemporal();

      flag(root, "data-object-motion", String(view?.objectMotion ?? ""));

      flag(root, "data-temporal-debug-view", view?.debugView ?? "");

      put(slot("temporal-status"), temporalHistoryStatus(view));

      put(
        slot("temporal-counts"),
        view
          ? `eligible batches ${view.eligibleBatches} · rigid history ${view.rigidBatches} · rejected history ${view.rejectedBatches}`
          : "no completed temporal frame",
      );
    }
  }

  /** Shows culling counts and status, from the frozen copy while frozen. */
  function renderCulling() {
    const view = frozen ? frozenCulling : readCulling();

    flag(root, "data-culling-enabled", String(view?.enabled ?? ""));

    flag(root, "data-culling-main-tested", String(view?.main.tested ?? ""));

    flag(root, "data-culling-main-visible", String(view?.main.visible ?? ""));

    flag(root, "data-culling-main-culled", String(view?.main.culled ?? ""));

    put(slot("culling-status"), visibilityCullingStatus(view));

    const views = (["main", "shadow", "reflection"] as const).map((name) => ({
      name,
      stats: view?.[name],
    }));

    cullingRows(views.length).forEach((target, i) => {
      const entry = views[i]!;

      put(target.label, entry.name);

      put(
        target.value,
        entry.stats
          ? `${count(entry.stats.tested)} · ${count(entry.stats.visible)} · ${count(entry.stats.culled)}`
          : "unknown",
      );
    });

    const instances = view?.instances;

    const main = instances?.views.find((sample) => sample.view === mainView);

    put(
      slot("culling-detail"),
      [
        view?.debugBounds
          ? `bounds: ${view.bounds.length} kept${view.boundsOmitted ? `, ${view.boundsOmitted} omitted` : ""}`
          : "bounds overlay off",
        instances
          ? `gpu instances ${instances.prepared} prepared · ${instances.nodes} nodes · ${instances.cacheHits} cache hits · ${main && main.sampleAgeFrames !== null ? `${main.visible} / ${main.candidates} visible, ${main.sampleAgeFrames} frames old` : "waiting for a gpu sample"}`
          : "gpu instance counters unavailable",
      ].join(" · "),
    );
  }

  /** Syncs the GPU, culling and temporal switches with the host's live state. */
  function renderControls(profile: GpuProfile | undefined) {
    // Host-owned switches follow live renderer state even while the display is frozen.
    if (gpu) {
      const view = frozen ? frozenGpu : profile;

      flag(root, "data-gpu-status", view?.status ?? "pending");

      flag(root, "data-gpu-sample-frame", String(view?.sampleFrame ?? ""));

      flag(
        root,
        "data-gpu-sample-age-frames",
        String(view?.sampleAgeFrames ?? ""),
      );

      const enabled = profile?.enabled ?? gpuRequested;

      pressed(gpuButton, enabled);

      disable(gpuButton, profile?.status === gpuStatus.unsupported);

      put(slot("gpu-name"), gpu.label ?? "renderer");
    }

    if (culling) {
      const visibility = readCulling();

      pressed(cullingButton, visibility?.enabled ?? cullingRequested);

      pressed(boundsButton, visibility?.debugBounds ?? cullingDebugRequested);

      pressed(instancesButton, visibility?.instances?.enabled ?? true);

      disable(
        instancesButton,
        !culling.setInstancesEnabled || visibility?.enabled === false,
      );
    }

    if (temporal) {
      const reconstruction = readTemporal();

      pressed(
        temporalButton,
        reconstruction?.objectMotion ?? objectMotionRequested,
      );

      const view = reconstruction?.debugView ?? temporalDebugRequested;

      if (temporalSelect.value !== view) temporalSelect.value = view;
    }
  }

  /** Fills the LOADING tab with the current session, the cold run and past sessions. */
  function renderLoading() {
    const current = frozen ? frozenPreparation : readPreparation();

    const history = frozen ? frozenPreparationHistory : preparationHistory();

    const sessions = [...history];

    if (current && !history.some((run) => run.id === current.id))
      sessions.push(current);

    const cold =
      sessions.find((run) => run.kind === freshContext) ?? sessions[0];

    const longest = Math.max(0, ...sessions.map((run) => run.elapsedMs));

    const seconds = longest >= msPerSecond;

    const unit = seconds ? msPerSecond : 1,
      digits = seconds ? 2 : 1;

    /** Formats a time in the unit shared by the whole tab. */
    const show2 = (ms: number) => fixed(ms / unit, digits);

    put(slot("unit"), seconds ? "S" : "MS");

    put(slot("unit-cold"), seconds ? "S" : "MS");

    put(slot("total"), current ? show2(current.elapsedMs) : "–");

    put(slot("cold"), cold ? show2(cold.elapsedMs) : "–");

    const stages = current?.stages ?? [];

    const hits = stages.reduce((sum, stage) => sum + stage.cacheHits, 0),
      misses = stages.reduce((sum, stage) => sum + stage.cacheMisses, 0),
      waiting = stages.reduce((sum, stage) => sum + stage.cacheInflight, 0);

    put(
      slot("cache"),
      hits + misses
        ? `${Math.round((hits / (hits + misses)) * percent)}%`
        : "–",
    );

    const step = axisStep(longest / unit || 1);

    const axisEnd = Math.max(step, Math.ceil(longest / unit / step) * step);

    const ticks = Array.from(
      { length: Math.round(axisEnd / step) + 1 },
      (_, i) => String(Number((i * step).toFixed(2))),
    );

    ticks.push(`${ticks.pop()} ${seconds ? "s" : "ms"}`);

    const axis = slot("axis");

    if (changed(axis, "ticks", ticks.join("|")))
      axis.replaceChildren(
        ...ticks.map((label) => {
          const tick = document.createElement("span");

          tick.textContent = label;

          return tick;
        }),
      );

    const coldStages = new Map(
      (cold && cold.id !== current?.id ? cold.stages : []).map((stage) => [
        stage.stage,
        stage.busyMs,
      ]),
    );

    let longestStage = "";

    for (const stage of stages)
      if (
        stage.busyMs >
        (stages.find((entry) => entry.stage === longestStage)?.busyMs ?? -1)
      )
        longestStage = stage.stage;

    const busy = stages.reduce((sum, stage) => sum + stage.busyMs, 0);

    const overlap = current ? Math.max(0, busy - current.elapsedMs) : 0;

    const rows = stageRows(stages.length + (overlap > 0 ? 1 : 0));

    const span = axisEnd * unit;

    stages.forEach((stage, i) => {
      const target = rows[i]!;

      const ghost = coldStages.get(stage.stage);

      put(target.label, stage.stage.replaceAll("-", " "));

      width(target.fill, stage.busyMs / span);

      width(target.value, (ghost ?? 0) / span);

      tone(target.root, stage.stage === longestStage ? "heavy" : "");

      flag(
        target.root,
        "title",
        `${stage.stage} · ${fixed(stage.busyMs)} ms busy · ${fixed(stage.totalMs)} ms combined · ${stage.count} operations${ghost === undefined ? "" : ` · cold ${fixed(ghost)} ms`}`,
      );
    });

    const overlapRow = rows[stages.length];

    if (overlapRow) {
      put(overlapRow.label, "overlap ≥");

      width(overlapRow.fill, overlap / span);

      width(overlapRow.value, 0);

      tone(overlapRow.root, "overlap");

      flag(
        overlapRow.root,
        "title",
        `stage busy time exceeds the session by ${fixed(overlap)} ms, so at least that much ran concurrently`,
      );
    }

    const cacheEntries: [string, number][] = [
      ["hits", hits],
      ["misses", misses],
      ...(waiting ? [["waiting", waiting] as [string, number]] : []),
    ];

    cacheRows(stages.length ? cacheEntries.length : 0).forEach((target, i) => {
      const [label, value] = cacheEntries[i]!;

      put(target.label, label);

      put(target.value, count(value));

      width(target.fill, value / Math.max(1, hits + misses + waiting));
    });

    sessionRows(sessions.length).forEach((target, i) => {
      const run = sessions[i]!;

      const now = run.id === current?.id;

      put(
        target.label,
        `#${run.id}${run.kind === freshContext ? " cold" : ""}${now ? " now" : ""}`,
      );

      put(target.value, show2(run.elapsedMs));

      width(target.fill, run.elapsedMs / Math.max(1, longest));

      tone(target.root, now ? "now" : "");

      flag(
        target.root,
        "title",
        `${run.label} · ${run.kind.replace("-", " ")} · ${run.status}`,
      );
    });

    put(slot("loading-status"), preparationStatus(!!preparation, current));
  }

  /** Fills the CAPTURE tab: budget, capture window, scope and DevTools switches, and kept captures. */
  function renderCapture() {
    for (const preset of presets)
      flag(preset.button, "aria-pressed", String(preset.fps === targetFps));

    const custom = !presets.some((preset) => preset.fps === targetFps);

    flag(customButton, "aria-pressed", String(custom));

    put(customButton, custom ? String(Number(targetFps.toFixed(2))) : "custom");

    put(slot("budget-ms"), `${fixed(budgetMs)} ms`);

    pressed(autoButton, autoRequested);

    const values: Record<(typeof editors)[number]["key"], string> = {
      threshold: `${fixed(captureWindow.thresholdMs ?? budgetMs * 2)} ms`,
      before: `${count(captureWindow.beforeFrames)} fr`,
      after: `${count(captureWindow.afterFrames)} fr`,
      cooldown: `${fixed(captureWindow.cooldownMs / msPerSecond)} s`,
    };

    for (const editor of editors) put(editor.button, values[editor.key]);

    const scopes = slot("scopes");

    put(scopes, monitor.detailed ? "ON" : "OFF");

    tone(scopes, monitor.detailed ? "" : "off");

    put(slot("scopes-why"), "while open, recording or armed");

    pressed(devtoolsButton, devtoolsRequested);

    put(
      slot("captured-meta"),
      `${captures.length} / ${captureLimit} · ${fixed(captures.reduce((sum, entry) => sum + entry.bytes, 0) / bytesPerMegabyte)} MB`,
    );

    show(slot("captures-empty"), !captures.length);

    if (capturesShown === capturesMade && captures.length) return;

    capturesShown = capturesMade;

    slot("captures").replaceChildren(...captures.map(captureRow));
  }

  /** Builds one kept capture's row: thumbnail, frame, time, nearby event and OPEN. */
  function captureRow(entry: Capture) {
    const element = document.createElement("div");

    element.className = "jank-cap";
    element.innerHTML =
      '<canvas class="jank-thumb" aria-hidden="true"></canvas><span class="jank-cap-text"><span><i class="jank-n"></i> <span class="jank-f"></span> <b class="jank-ms"></b></span><span class="jank-near"></span></span><button type="button" class="jl-btn jl-small">OPEN</button>';

    put(part(element, ".jank-n"), `#${entry.number}`);

    put(part(element, ".jank-f"), count(entry.frame));

    const ms = part(element, ".jank-ms");

    put(ms, `${fixed(entry.ms)} ms`);

    tone(ms, over(entry.ms) ? "miss" : "");

    put(part(element, ".jank-near"), entry.near);

    const open = findIn(element, "button", HTMLButtonElement);

    flag(open, "aria-label", `Open capture ${entry.number} in viewer`);

    if (!options.viewerUrl) {
      open.disabled = true;

      flag(
        open,
        "title",
        "set viewerUrl in the panel options to open recordings in the viewer",
      );
    }

    open.addEventListener(
      "click",
      () =>
        openInViewer(
          entry.json,
          `jank-capture-${entry.number}.json`,
          captureError,
        ),
      listen,
    );

    const context = prepareCanvas(
      findIn(element, "canvas", HTMLCanvasElement),
      thumbnailWidth,
      thumbnailHeight,
    );

    if (context)
      drawThumbnail(
        context,
        (theme ??= graphTheme(root)),
        entry.intervals,
        limit(),
        thumbnailWidth,
        thumbnailHeight,
      );

    return element;
  }

  /** Shows the panel's own cost and lowers its redraw rate when refresh gets expensive. */
  function renderOverhead(snapshot: DiagnosticSnapshot) {
    const costs = snapshot.overhead;

    put(slot("oh-collect"), fixed(costs.collection.mean, 2));

    put(slot("oh-collect-peak"), fixed(costs.collection.peak, 2));

    put(slot("oh-refresh"), fixed(costs.refresh.mean, 2));

    put(slot("oh-refresh-peak"), fixed(costs.refresh.peak, 2));

    // The panel measures itself and backs off when its own refresh gets expensive.
    if (costs.refresh.mean > lowerAboveMs) lowered = true;
    else if (costs.refresh.mean < restoreBelowMs) lowered = false;

    put(
      slot("oh-note"),
      lowered
        ? `excludes browser paint and GPU work · redraw lowered to 4 per s, refresh over ${lowerAboveMs} ms avg`
        : "excludes browser paint and GPU work",
    );

    flag(slot("oh-note"), "title", costs.measurement);

    put(slot("honest-cpu"), honesty.cpu);

    put(slot("honest-gpu"), honesty.gpu);
  }

  return {
    refresh,
    dispose() {
      if (disposed) return;

      disposed = true;

      abort.abort();

      mountedShells.delete(shell);

      root.remove();

      shell.classList.remove("jank-host");

      monitor.setExpanded(false);
    },
  };
}
