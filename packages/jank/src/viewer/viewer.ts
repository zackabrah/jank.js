import type { ComparisonReport } from "../comparison/comparison.ts";
import type { Recording, RecordingProblem } from "../recordings/recording.ts";

export type ViewerDocument =
  | { readonly kind: "recording"; readonly recording: Recording }
  | { readonly kind: "comparison"; readonly comparison: ComparisonReport };
export type ViewerImportResult =
  | { readonly ok: true; readonly kind: ViewerDocument["kind"] }
  | { readonly ok: false; readonly problem: RecordingProblem };
export type ViewerState =
  | { readonly status: "empty" }
  | {
      readonly status: "loaded";
      readonly recording: Recording | null;
      readonly comparison: ComparisonReport | null;
      readonly selectedTrialIndex: number | null;
      readonly selectedFrameId: number | null;
      readonly firstVisibleIndex: number;
      readonly visibleFrameCount: number;
      readonly comparisonElapsedMs: number;
      readonly comparisonWindowMs: number;
    };
export interface Viewer {
  /** Validates and detaches data before replacing the current document. */
  load(recording: Recording): void;
  loadComparison(comparison: ComparisonReport): void;
  /** Bounded local import; failure preserves the current document and selection. */
  import(json: string): ViewerImportResult;
  selectTrial(index: number): void;
  selectFrame(frameId: number): void;
  setRange(firstIndex: number, frameCount: number): void;
  /** Relative to each trial's first sealed measured frame; gaps stay unselected. */
  selectComparisonTime(elapsedMs: number): void;
  snapshot(): ViewerState;
  dispose(): void;
}
export type CreateViewer = (options: { readonly container: HTMLElement }) => Viewer;
