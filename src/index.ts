export { buildInfo, type BuildInfo } from "./core/build-info.ts";

/** Public browser monitor API. Importing the module does not access the DOM. */
export { createDiagnostics } from "./core/diagnostics.ts";

export type {
  Diagnostics,
  DiagnosticChannel,
  DiagnosticEvent,
  DiagnosticFrame,
  DiagnosticSnapshot,
  DiagnosticValues,
} from "./core/diagnostics.ts";

export { createPerformanceTray } from "./performance/tray.ts";

export type {
  PerformanceTrayOptions,
  PerformanceGpuSource,
  PerformanceCullingSource,
  PerformanceTemporalSource,
  PerformancePreparationSource,
} from "./performance/tray.ts";

export {
  createPreparationProfiler,
  measurePreparation,
  defaultPreparationStages,
} from "./core/preparation.ts";

export type {
  PreparationProfiler,
  PreparationRecorder,
  PreparationSnapshot,
  PreparationStage,
  PreparationStageSnapshot,
  PreparationKind,
  PreparationStatus,
  PreparationCacheOutcome,
} from "./core/preparation.ts";

export {
  createCullingBoundsOverlay,
  CullingBoundsProjector,
} from "./performance/culling-overlay.ts";

export type {
  CullingDiagnostics,
  CullingBounds,
  CullingViewStats,
} from "./types/culling-types.ts";

export type { GpuProfile, GpuPassTiming } from "./types/gpu-profile-types.ts";

export type {
  TemporalDiagnostics,
  TemporalDebugView,
  TemporalMotion,
} from "./types/motion-types.ts";

export type { DiagnosticsOptions } from "./core/diagnostics.ts";

export type {
  PerformanceRecording,
  DiagnosticScope,
  DiagnosticSystem,
  DiagnosticOverhead,
  FrameBudget,
  CaptureStatus,
  AutoCaptureOptions,
  RecordingMetadata,
  RecordingEnvironment,
} from "./core/recording-types.ts";

export {
  parseRecording,
  serializeRecording,
  RecordingFormatError,
  MAX_RECORDING_BYTES,
} from "./core/recording.ts";

export {
  inspectFrame,
  recordingSummary,
  selectFrameRange,
} from "./core/inspection.ts";

export { createDevToolsSink } from "./core/devtools.ts";

export type { DiagnosticTraceSink } from "./core/devtools.ts";

export { estimateTimerResolution } from "./core/environment.ts";

export { createRecordingViewModel } from "./viewer/model.ts";

export type {
  RecordingViewModel,
  RecordingViewerState,
} from "./viewer/model.ts";
