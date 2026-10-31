export { type GpuCoverage, summarizeGpuCoverage } from "./analysis/gpu-coverage.ts";
export { type FrameSummary, type InspectFrame, inspectFrame } from "./analysis/summary.ts";
export { createComparison } from "./browser/create-comparison.ts";
export { createProfiler } from "./browser/create-profiler.ts";
export { finalizeRecording, type RecordingFinalization } from "./browser/finalize-recording.ts";
export { type ComparisonResult, parseComparison } from "./comparison/codec.ts";
export type {
  Comparison,
  ComparisonContext,
  ComparisonHost,
  ComparisonMetric,
  ComparisonOptions,
  ComparisonReport,
  ComparisonSnapshot,
  ComparisonSummary,
  ComparisonTiming,
  ComparisonTrial,
} from "./comparison/comparison.ts";
export { serializeComparison } from "./comparison/recordings.ts";
export type { Channel, ScopeToken } from "./core/channels.ts";
export type {
  ChannelDescription,
  CounterSample,
  CounterValue,
  EventSample,
  FrameSample,
  ScopeCoverage,
  ScopeSample,
} from "./core/frames.ts";
export type {
  GpuDurationSample,
  GpuFrameResolution,
  GpuFrameResolver,
  GpuIncompleteReason,
  GpuIntervalPass,
  GpuIntervalSample,
  GpuMetrics,
  GpuPassSample,
  GpuRejectedPass,
  GpuSample,
  GpuState,
  GpuTimestampRejection,
} from "./core/gpu.ts";
export type { ProfilerSnapshot } from "./core/snapshot.ts";
export type {
  CreateLoadingProfiler,
  LoadingOperation,
  LoadingProfiler,
  LoadingRun,
  LoadingSnapshot,
} from "./loading/loading.ts";
export { createPanel } from "./panel/create-panel.ts";
export type { CreatePanel, Panel, PanelMode, PanelOptions } from "./panel/panel.ts";
export type {
  ChannelOptions,
  CreateProfiler,
  Profiler,
  ProfilerOptions,
  TraceSink,
} from "./profiler.ts";
export type {
  CaptureController,
  CaptureOptions,
  CaptureProgress,
  CaptureState,
  SavedCapture,
} from "./recordings/capture.ts";
export { parseRecording, serializeRecording } from "./recordings/codec.ts";
export { RecordingError } from "./recordings/read-values.ts";
export type {
  ParseRecording,
  Recording,
  RecordingEnvironment,
  RecordingProblem,
  RecordingResult,
  SerializeRecording,
} from "./recordings/recording.ts";
export type {
  GpuSource,
  LoadingSource,
  TemporalSnapshot,
  TemporalSource,
  VisibilitySnapshot,
  VisibilitySource,
} from "./sources.ts";

export { createViewer } from "./viewer/create-viewer.ts";
export type {
  CreateViewer,
  Viewer,
  ViewerDocument,
  ViewerImportResult,
  ViewerState,
} from "./viewer/viewer.ts";
